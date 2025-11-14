"""
Image Tagger flask application.
"""

from io import BytesIO
import json
import os
import random
import sqlite3

from PIL import Image
import click
from flask import Flask, abort, current_app, g, render_template, request, send_file

VERSION = "1.0.1"

app = Flask("Image Tagger")

app.config.from_file("config.json", load=json.load)


def _release_db(*args, **kwargs): # pylint: disable=unused-argument
    db = g.get('db', None)

    if db is not None:
        db.close()


def _get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(current_app.config['DATABASE'],
                               detect_types=sqlite3.PARSE_DECLTYPES)

    return g.db


@click.command('init-db')
def init_db_command():
    """Clear existing database and (re)create tables."""

    db = _get_db()

    with current_app.open_resource(os.path.join('resources', 'schema.sql')) as s:
        db.executescript(s.read().decode('utf-8'))

    click.echo("Initialized the database.")

app.teardown_appcontext(_release_db)
app.cli.add_command(init_db_command)


@app.route('/', methods=('GET',))
def root():
    """The main page of the application."""

    context = {
        "VERSION": VERSION,
    }

    return render_template("index.html", **context)


@app.route('/tagManagement', methods=('GET',))
def tag_management():
    """The page that allows managing tags."""

    context = {
        "VERSION": VERSION,
    }

    return render_template("manage.html", **context)


@app.route('/images', methods=('GET',))
def images():
    """Lists all the images."""

    folder = current_app.config["IMAGES_FOLDER"]

    return [
        fn for fn in sorted(os.listdir(folder))
        if os.path.isfile(os.path.join(folder, fn))
        and os.path.splitext(fn)[-1] == '.bmp'
    ]


@app.route('/searchImages', methods=('POST',))
def search_images():
    """Search images by tags"""

    tags_list = json.loads(request.form.get('tags'))

    db = _get_db()
    c = db.cursor()

    c.execute(
        f"""
        SELECT fn FROM images WHERE image_id IN (
            SELECT image_id FROM tagged_images
            WHERE tag_id IN ({','.join('?' * len(tags_list))})
        );
        """,
        tags_list
    )
    found_images = [fn for fn, *_ in c]

    c.close()

    return found_images, 200


@app.route('/loadImage', methods=('GET',))
def load_image():
    """Loads and optionally resizes an image, serving it as JPEG."""

    folder = current_app.config["IMAGES_FOLDER"]
    fn = request.args.get('fn')
    make_thumbnail = request.args.get('tn', 'false').lower() == 'true'

    if not fn:
        return abort(404)

    path = os.path.join(folder, fn)
    if not os.path.isfile(path):
        return abort(404)

    # Open image using Pillow
    with Image.open(path) as img:
        # Convert to RGB (JPEG doesn’t support RGBA or P)
        img = img.convert("RGB")

        # If tn=true, make a thumbnail
        if make_thumbnail:
            img.thumbnail((192, 108))

        # Write image to memory buffer as JPEG
        img_io = BytesIO()
        img.save(img_io, format='JPEG', quality=85, optimize=True)
        img_io.seek(0)

        # Serve directly from memory
        return send_file(
            img_io,
            mimetype='image/jpeg',
            as_attachment=False,
            max_age=2_592_000  # 30 days
        )



@app.route('/tags', methods=('GET',))
def tags():
    """Loads the list of tags"""

    db = _get_db()
    c = db.cursor()

    c.execute("SELECT tag_id, name, used FROM tags;")

    t = [{ "id": i, "name": n, "used": u } for i, n, u in c]

    c.close()

    return t


@app.route('/imageTags', methods=('GET',))
def image_tags():
    """Returns the list of tag ids for an image"""

    fn = request.args.get('fn', None)

    if fn is None:
        return []

    db = _get_db()
    c = db.cursor()

    c.execute("SELECT image_id FROM images WHERE fn = ?;",
              (fn,))

    r = c.fetchone()

    if r is None:
        return []

    c.execute("SELECT tag_id FROM tagged_images WHERE image_id = ?;",
              r)

    t = [x for x, *_ in c]

    c.close()

    return t


@app.route('/addTag', methods=('POST',))
def add_tag():
    """Adds a new tag to the list of available tags"""

    name = request.form.get('name')
    description = request.form.get('description')
    db = _get_db()
    c = db.cursor()

    if not name:
        return abort(400)

    c.execute("INSERT INTO tags (name, description, used) VALUES (?, ?, ?);",
              (name, description, 0))

    tag_id = c.lastrowid

    db.commit()
    c.close()

    return {
        "id": tag_id,
        "name": name,
        "description": description,
    }


@app.route('/toggleTags', methods=('POST',))
def toggle_tags():
    """Toggle tags for image"""

    fn = request.form.get('fn')
    tags_to_toggle = set(json.loads(request.form.get('tags')))
    db = _get_db()
    c = db.cursor()

    c.execute("SELECT image_id FROM images WHERE fn = ?;",
              (fn,))
    r = c.fetchone()

    if r is None:
        c.execute("INSERT INTO images (fn) VALUES (?);",
                  (fn,))
        i = c.lastrowid
        db.commit()
    else:
        i, *_ = r

    c.execute("SELECT tag_id FROM tagged_images WHERE image_id = ?;",
              (i,))
    current_tags = set(t for t, *_ in c)

    for t in tags_to_toggle:
        if t in current_tags:
            c.execute("DELETE FROM tagged_images WHERE image_id = ? AND tag_id = ?;",
                      (i, t))
            c.execute("UPDATE tags SET used = used - 1 WHERE tag_id = ?;",
                      (t,))
        else:
            c.execute("INSERT INTO tagged_images (image_id, tag_id) VALUES (?, ?);",
                      (i, t))
            c.execute("UPDATE tags SET used = used + 1 WHERE tag_id = ?;",
                      (t,))

    db.commit()
    c.close()

    return list(current_tags ^ tags_to_toggle)


@app.route('/tagInfo', methods=('GET',))
def tag_info():
    """Returns information on the specified tag"""

    t = request.args.get('tag', None)

    if t is None:
        return { "description": "", "images": [] }

    db = _get_db()
    c = db.cursor()

    c.execute("SELECT description FROM tags WHERE tag_id = ?;",
              (t,))

    r = { "description": next((d for d, *_ in c), "") }

    c.execute("SELECT image_id FROM tagged_images WHERE tag_id = ?;",
              (t,))

    i = [x for x, *_ in c]
    i = i if len(i) < 4 else random.sample(i, 3)

    r["images"] = [next(f for f, *_ in c.execute("SELECT fn FROM images WHERE image_id = ?;", (x,)))
                   for x in i]

    c.close()

    return r


@app.route('/updateTag', methods=['POST'])
def update_tag():
    """Updates a tag's name or description (only fields provided)."""

    tag_id = request.form.get('tag_id')
    name = request.form.get('name')
    description = request.form.get('description')

    if not tag_id:
        return {"error": "Missing tag_id"}, 400

    db = _get_db()
    c = db.cursor()

    # Only update provided fields
    fields = []
    params = []
    if name is not None:
        fields.append("name = ?")
        params.append(name)
    if description is not None:
        fields.append("description = ?")
        params.append(description)

    if not fields:
        return {"status": "no changes"}, 200

    params.append(tag_id)
    c.execute(f"UPDATE tags SET {', '.join(fields)} WHERE tag_id = ?;", params)
    db.commit()
    c.close()

    return {"status": "success"}


@app.route('/deDuplicate', methods=('POST',))
def de_duplicate():
    """Merge several tags into the first one and remove the redundant ones."""

    tags_list = json.loads(request.form.get('tags'))

    keep_id = tags_list[0]
    remove_ids = tags_list[1:]

    db = _get_db()
    c = db.cursor()

    db.execute('BEGIN')

    # Step 1: Delete duplicates that would be created by merging
    c.execute(
        f"""
        DELETE FROM tagged_images
        WHERE tag_id IN ({','.join('?' * len(remove_ids))})
            AND image_id IN (
                SELECT image_id FROM tagged_images WHERE tag_id = ?
            );
        """,
        (*remove_ids, keep_id)
    )

    # Step 2: Update remaining associations to use the kept tag
    c.execute(
        f"""
        UPDATE OR IGNORE tagged_images
        SET tag_id = ?
        WHERE tag_id IN ({','.join('?' * len(remove_ids))});
        """,
        (keep_id, *remove_ids)
    )

    # Step 3: Delete the redundant tag rows
    c.execute(
        f"DELETE FROM tags WHERE tag_id IN ({','.join('?' * len(remove_ids))});",
        remove_ids
    )

    # Step 4: Update used
    c.execute(
        "UPDATE OR IGNORE tags SET used = ("
        "SELECT COUNT(*) FROM tagged_images WHERE tag_id = ?"
        ") WHERE tag_id = ?;",
        (keep_id, keep_id)
    )

    db.commit()
    c.close()

    return {"status": "success", "kept": keep_id, "removed": remove_ids}, 200


@app.route('/deleteTags', methods=('POST',))
def delete_tags():
    """Delete the tags specified by the "tags" form field"""

    tags_list = json.loads(request.form.get('tags'))

    db = _get_db()
    c = db.cursor()

    db.execute('BEGIN')

    # Step 1: Delete tags from images
    c.execute(
        f"""
        DELETE FROM tagged_images
        WHERE tag_id IN ({','.join('?' * len(tags_list))});
        """,
        tags_list
    )

    # Step 2: Delete the actual tags
    c.execute(
        f"DELETE FROM tags WHERE tag_id IN ({','.join('?' * len(tags_list))});",
        tags_list
    )

    db.commit()
    c.close()

    return {"status": "success", "removed": tags_list}, 200


@app.route('/latest', methods=('GET',))
def latest():
    """Returns the latest image that was tagged"""

    db = _get_db()
    c = db.cursor()

    c.execute("SELECT fn FROM images ORDER BY image_id DESC LIMIT 1;")

    r = c.fetchone()

    c.close()

    if r is not None:
        return { "fn": r[0] }

    return { "fn": None }
