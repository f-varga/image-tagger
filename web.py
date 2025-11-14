"""
Image Tagger flask application.
"""

from io import BytesIO
import json
import os
import random
import sqlite3
import textwrap

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError
import click
from flask import Flask, abort, current_app, g, jsonify, render_template, request, send_file

VERSION = "1.0.3"

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


def _error_image(status, message):
    img_w, img_h = 1920, 1080
    img = Image.new('RGB', (img_w, img_h), color='rgb(198, 198, 198)')
    font = ImageFont.truetype(os.path.join("resources", "RobotoMono-Regular.ttf"), size=72.0)
    text = '\n'.join([f"HTTP ERROR {status}"] + textwrap.wrap(message, 80))
    draw = ImageDraw.Draw(img)
    _, _, w, h = draw.textbbox((0, 0), text, font=font, align='center')
    draw.text(((img_w - w) / 2, (img_h - h) / 2), text,
              font=font, align='center', fill='rgb(255, 0, 255)')
    img_io = BytesIO()
    img.save(img_io, format='JPEG', quality=85)
    img_io.seek(0)

    return img_io


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(500)
def server_error(err):
    """Handle errors gracefully."""

    if request.endpoint == 'load_image':
        img_io = _error_image(err.code, err.description)
        response = send_file(
            img_io,
            mimetype='image/jpeg',
            as_attachment=False,
            max_age=300
        )

        return response, err.code

    return jsonify({
        "error": {
            "code": err.code,
            "name": err.name,
        },
        "reason": err.description,
    }), err.code


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

    try:
        return [
            fn for fn in sorted(os.listdir(folder))
            if os.path.isfile(os.path.join(folder, fn))
            and os.path.splitext(fn)[-1] in ('.bmp', '.jpg', '.png')
        ], 200

    except FileNotFoundError:
        current_app.logger.exception('Failed to list images: Configured folder not found.')
        return abort(500,
                     'The configured images folder was not found. '
                     'Please check the IMAGES_FOLDER configuration.')
    except PermissionError:
        current_app.logger.exception('Failed to list images: Permission denied.')
        return abort(500,
                     'The application lacks permission to access the images folder or '
                     'some files within it. Check application permissions.')


@app.route('/searchImages', methods=('POST',))
def search_images():
    """Search images by tags"""

    tags_data = request.form.get('tags')
    if tags_data is None:
        return abort(400, 'The list of tags to search for was not sent.')

    try:
        tags_list = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, 'The request data may have been corrupted.')

    if not isinstance(tags_list, list) or not tags_list:
        return abort(400, 'The list of tags received seems to be in an unexpected structure.')

    c = None
    try:
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

        return found_images, 200

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/loadImage', methods=('GET',))
def load_image():
    """Loads and optionally resizes an image, serving it as JPEG."""

    folder = current_app.config["IMAGES_FOLDER"]
    fn = request.args.get('fn', None)
    make_thumbnail = request.args.get('tn', 'false').lower() == 'true'

    if not fn:
        return abort(400, 'No filename specified.')

    path = os.path.join(folder, fn)
    if not os.path.isfile(path):
        return abort(404, 'The file no longer exists.')

    try:
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

    except PermissionError:
        current_app.logger.exception("Could not load image file.")
        return abort(500,
                     "The image file cannot be opened. Verify the permissions "
                     "and check if another application is not currently using "
                     "the file.")
    except UnidentifiedImageError:
        current_app.logger.exception("Unidentified image format.")
        return abort(500,
                     "The image format for the current file is not recognized.")
    except OSError:
        current_app.logger.exception("File access error.")
        return abort(500,
                     "The operating system reported an error durring the "
                     "handling of the image file.")



@app.route('/tags', methods=('GET',))
def tags():
    """Loads the list of tags"""

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT tag_id, name, used FROM tags;")

        t = [{ "id": i, "name": n, "used": u } for i, n, u in c]

        return t, 200

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/imageTags', methods=('GET',))
def image_tags():
    """Returns the list of tag ids for an image"""

    fn = request.args.get('fn', None)

    if not fn:
        return abort(400, 'The file name parameter was not received.')

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT image_id FROM images WHERE fn = ?;",
                  (fn,))

        r = c.fetchone()

        if r is None:
            return [], 200

        c.execute("SELECT tag_id FROM tagged_images WHERE image_id = ?;",
                  r)

        t = [x for x, *_ in c]

        return t, 200

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/addTag', methods=('POST',))
def add_tag():
    """Adds a new tag to the list of available tags"""

    name = request.form.get('name', '')
    description = request.form.get('description', None)

    if not name or not name.strip():
        return abort(400, 'The tag name is required, but was not present.')

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        db.execute("BEGIN")

        c.execute("INSERT INTO tags (name, description, used) VALUES (?, ?, ?);",
                  (name, description, 0))

        tag_id = c.lastrowid

        db.commit()

        return {
            "id": tag_id,
            "name": name,
            "description": description,
        }, 201

    except (sqlite3.Error, sqlite3.OperationalError):
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/toggleTags', methods=('POST',))
def toggle_tags():
    """Toggle tags for image"""

    fn = request.form.get('fn', None)
    tags_data = request.form.get('tags', None)

    if not fn or not fn.strip():
        return abort(400, 'The filename of the image was not given.')
    if not tags_data:
        return abort(400, 'The list of tags to toggle was not sent.')

    try:
        tags_to_toggle = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, 'The request data may have been corrupted.')

    if not isinstance(tags_to_toggle, list) or not tags_to_toggle:
        return abort(400, 'The list of tags received seems to be in an unexpected structure.')

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        db.execute("BEGIN")

        c.execute("SELECT image_id FROM images WHERE fn = ?;",
                  (fn,))
        r = c.fetchone()

        if r is None:
            c.execute("INSERT INTO images (fn) VALUES (?);",
                      (fn,))
            i = c.lastrowid
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

        return list(current_tags ^ tags_to_toggle), 200

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     'A database integrity error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    except (sqlite3.Error, sqlite3.OperationalError):
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/tagInfo', methods=('GET',))
def tag_info():
    """Returns information on the specified tag"""

    t = request.args.get('tag', None)

    if t is None:
        return abort(400, 'The tag ID was not received.')

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT description FROM tags WHERE tag_id = ?;",
                  (t,))

        r = {
            "description": next((d for d, *_ in c), ""),
            "images": [],
        }

        c.execute("SELECT image_id FROM tagged_images WHERE tag_id = ?;",
                  (t,))

        i = [x for x, *_ in c]
        i = i if len(i) < 4 else random.sample(i, 3)

        r["images"] = [next(f for f, *_ in
                            c.execute("SELECT fn FROM images WHERE image_id = ?;",
                                      (x,)))
                       for x in i]

        return r

    except (sqlite3.Error, sqlite3.OperationalError):
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/updateTag', methods=['POST'])
def update_tag():
    """Updates a tag's name or description (only fields provided)."""

    tag_id = request.form.get('tag_id')
    name = request.form.get('name')
    description = request.form.get('description')

    if not tag_id:
        return abort(400, 'The tag ID was not received.')

    c = None
    try:
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
            return { "status": "no changes" }, 200

        db.execute("BEGIN")

        params.append(tag_id)
        c.execute(f"UPDATE tags SET {', '.join(fields)} WHERE tag_id = ?;", params)

        db.commit()

        return { "status": "success" }, 200

    except (sqlite3.Error, sqlite3.OperationalError):
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/deDuplicate', methods=('POST',))
def de_duplicate():
    """Merge several tags into the first one and remove the redundant ones."""

    tags_data = request.form.get('tags')
    if tags_data is None:
        return abort(400, 'The list of tags to search for was not sent.')

    try:
        tags_list = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, 'The request data may have been corrupted.')

    if not isinstance(tags_list, list):
        return abort(400, 'The list of tags received seems to in an unexpected structure.')

    if len(tags_list) < 2:
        return abort(400, 'The list of tags received contains less than two tags.')

    keep_id = tags_list[0]
    remove_ids = tags_list[1:]

    c = None
    try:
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

        return {"status": "success", "kept": keep_id, "removed": remove_ids}, 200

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     'A database integrity error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    except (sqlite3.Error, sqlite3.OperationalError):
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/deleteTags', methods=('POST',))
def delete_tags():
    """Delete the tags specified by the "tags" form field"""

    tags_data = request.form.get('tags', None)
    if tags_data is None:
        return abort(400, 'The list of tags to search for was not sent.')

    try:
        tags_list = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, 'The request data may have been corrupted.')

    if not isinstance(tags_list, list) or not tags_list:
        return abort(400, 'The list of tags received seems to in an unexpected structure.')

    c = None
    try:
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

        return {"status": "success", "removed": tags_list}, 200

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     'A database integrity error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    except (sqlite3.Error, sqlite3.OperationalError):
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()


@app.route('/latest', methods=('GET',))
def latest():
    """Returns the latest image that was tagged"""

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT fn FROM images ORDER BY image_id DESC LIMIT 1;")

        r = c.fetchone()

        if r is not None:
            return { "fn": r[0] }, 200

        return { "fn": None }, 200

    except (sqlite3.Error, sqlite3.OperationalError):
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     'A database access error occurred. Please verify that '
                     'the database file has not been corrupted and it is '
                     'not currently used by another process.')
    finally:
        if c is not None:
            c.close()
