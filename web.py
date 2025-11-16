"""
Image Tagger flask application.
"""

from collections import defaultdict
import functools
from io import BytesIO
import json
import os
import random
import re
import sqlite3
import textwrap
from typing import Any, Mapping

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError
import click
from flask import Flask, abort, current_app, g, jsonify, render_template, request, send_file

VERSION = "1.0.11"
SUPPORTED_LANGS = ["en", "fr", "ja"]
DEFAULT_LANG = "en"

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


@click.command('bump-resources-version')
def bump_resources_version():
    """Bump version of resources files when no changes that affect localization were made."""

    endpoints = [
        'root',
        'tag_management',
        'images',
        'search_images',
        'load_image',
        'tags',
        'image_tags',
        'add_tag',
        'toggle_tags',
        'tag_info',
        'update_tag',
        'de_duplicate',
        'delete_tags',
        'latest',
    ]
    ep_group = "|".join(map(re.escape, endpoints))
    lang_group = "|".join(map(re.escape, SUPPORTED_LANGS))
    version_pattern = r"\d+\.\d+\.\d+[ab]?"
    pattern = re.compile(rf"^({ep_group})-({version_pattern})\.({lang_group})\.json$")

    renamed_any = False
    folder = "resources"
    click.echo(f"Scanning folder: {folder}")
    for fn in os.listdir(folder):
        match = pattern.match(fn)
        if not match:
            continue
        endpoint, version, lang = match.group(1), match.group(2), match.group(3)
        if version == VERSION:
            click.echo(f"    ✔ The resources file \"{fn}\" was already "
                       f"at the current version. Skipping.")
            continue
        new_fn = f"{endpoint}-{VERSION}.{lang}.json"
        os.rename(os.path.join(folder, fn), os.path.join(folder, new_fn))
        click.echo(f"    ✔ Renamed \"{fn}\" to \"{new_fn}\".")
        renamed_any = True

    if not renamed_any:
        click.echo("No resource files versions were bumped.")
    else:
        click.echo("✔ Version bump complete.")


def with_localization(func):
    """Wrapper method used for annotating endpoints for localization."""

    def merge_recursively(a: dict, b: dict):
        for key, value in b.items():
            if key in a and isinstance(a[key], dict) and isinstance(value, dict):
                merge_recursively(a[key], value)
            else:
                a[key] = value

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # Detect best match from Accept-Language headers
        lang = request.accept_languages.best_match(SUPPORTED_LANGS)

        # If no match, fall back to default
        if lang is None:
            lang = DEFAULT_LANG

        # Load JSON resource file
        filename = os.path.join("resources", f"{request.endpoint}-{VERSION}.{lang}.json")
        default = os.path.join("resources", f"{request.endpoint}-{VERSION}.{DEFAULT_LANG}.json")
        try:
            with current_app.open_resource(filename, "r", encoding="utf-8") as f:
                resources = json.load(f)
        except FileNotFoundError:
            # Safety fallback in case the file is missing
            with current_app.open_resource(default, "r", encoding="utf-8") as f:
                resources = json.load(f)

        # Load common JSON resource file
        filename = os.path.join("resources", f"common-{VERSION}.{lang}.json")
        default = os.path.join("resources", f"common-{VERSION}.{DEFAULT_LANG}.json")
        try:
            with current_app.open_resource(filename, "r", encoding="utf-8") as f:
                merge_recursively(resources, json.load(f))
        except FileNotFoundError:
            # Safety fallback in case the file is missing
            with current_app.open_resource(default, "r", encoding="utf-8") as f:
                merge_recursively(resources, json.load(f))

        # Pass resources as a keyword argument
        return func(*args, lang=lang, resources=resources, **kwargs)

    return wrapper

app.teardown_appcontext(_release_db)
app.cli.add_command(init_db_command)
app.cli.add_command(bump_resources_version)


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

    lang = request.accept_languages.best_match(SUPPORTED_LANGS)
    if lang is None:
        lang = DEFAULT_LANG

    if request.endpoint == 'load_image':
        img_io = _error_image(err.code, err.description)
        response = send_file(
            img_io,
            mimetype='image/jpeg',
            as_attachment=False,
            max_age=300
        )

        return response, err.code, { "Content-Language": lang }

    return jsonify({
        "error": {
            "code": err.code,
            "name": err.name,
        },
        "reason": err.description,
    }), err.code, { "Content-Language": lang }


@app.route('/', methods=('GET',))
@with_localization
def root(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """The main page of the application."""

    context = {
        "VERSION": VERSION,
        "lang": lang,
    }

    if "template" in resources:
        context.update(resources.get("template"))

    if "ui" in resources:
        context["ui"] = json.dumps(resources.get("ui"))

    return render_template("index.html", **context), 200, { "Content-Language": lang }


@app.route('/tagManagement', methods=('GET',))
@with_localization
def tag_management(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """The page that allows managing tags."""

    context = {
        "VERSION": VERSION,
        "lang": lang,
    }

    if "template" in resources:
        context.update(resources.get("template"))

    if "ui" in resources:
        context["ui"] = json.dumps(resources.get("ui"))

    return render_template("manage.html", **context), 200, { "Content-Language": lang }


@app.route('/images', methods=('GET',))
@with_localization
def images(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Lists all the images."""

    folder = current_app.config["IMAGES_FOLDER"]

    try:
        return [
            fn for fn in sorted(os.listdir(folder))
            if os.path.isfile(os.path.join(folder, fn))
            and os.path.splitext(fn)[-1] in ('.bmp', '.jpg', '.png')
        ], 200, { "Content-Language": lang }

    except FileNotFoundError:
        current_app.logger.exception('Failed to list images: Configured folder not found.')
        return abort(500,
                     resources.get("except").get("FileNotFoundError"))
    except PermissionError:
        current_app.logger.exception('Failed to list images: Permission denied.')
        return abort(500,
                     resources.get("except").get("PermissionError"))


@app.route('/searchImages', methods=('POST',))
@with_localization
def search_images(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Search images by tags"""

    tags_data = request.form.get('tags')
    if tags_data is None:
        return abort(400, resources.get("validation").get("tags_data is None"))

    try:
        tags_list = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, resources.get("except").get("json.JSONDecodeError"))

    is_what_we_expect = {
        'tags': isinstance(tags_list, list) and tags_list
    }
    if not is_what_we_expect['tags']:
        return abort(400, resources.get("validation").get("not is_what_we_expect['tags']"))

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute(
            f"""
            SELECT tag_id, image_id FROM tagged_images
            WHERE tag_id IN ({','.join('?' * len(tags_list))});
            """,
            tags_list
        )

        d = defaultdict(set)
        for tag_id, image_id in c:
            d[tag_id].add(image_id)
        found_images = list(set.intersection(*d.values()))
        c.execute(
            f"""
            SELECT fn FROM images
            WHERE image_id IN ({','.join('?' * len(found_images))});
            """,
            found_images
        )

        found_images = [fn for fn, *_ in c]

        return found_images, 200, { "Content-Language": lang }

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/loadImage', methods=('GET',))
@with_localization
def load_image(lang: str, # pylint: disable=unused-argument
               resources: Mapping[str, Mapping[str, Any]]):
    """Loads and optionally resizes an image, serving it as JPEG."""

    folder = current_app.config["IMAGES_FOLDER"]
    fn = request.args.get('fn', None)
    make_thumbnail = request.args.get('tn', 'false').lower() == 'true'

    if not fn:
        return abort(400, resources.get("validation").get("not fn"))

    path = os.path.join(folder, fn)
    if not os.path.isfile(path):
        return abort(404, resources.get("validation").get("not os.path.isfile(path)"))

    try:
        with Image.open(path) as img:
            # Convert to RGB (JPEG doesn’t support RGBA or P)
            img = img.convert("RGB")

            # If tn=true, make a thumbnail
            if make_thumbnail:
                img.thumbnail((192, 108), Image.Resampling.LANCZOS)

            # Write image to memory buffer as JPEG
            img_io = BytesIO()
            img.save(img_io, format='JPEG', quality=85, optimize=True)
            img_io.seek(0)

            # Serve directly from memory
            response = send_file(
                img_io,
                mimetype='image/jpeg',
                as_attachment=False,
                max_age=2_592_000  # 30 days
            )

            return response

    except PermissionError:
        current_app.logger.exception("Could not load image file.")
        return abort(500,
                     resources.get("except").get("PermissionError"))
    except UnidentifiedImageError:
        current_app.logger.exception("Unidentified image format.")
        return abort(500,
                     resources.get("except").get("UnidentifiedImageError"))
    except OSError:
        current_app.logger.exception("File access error.")
        return abort(500,
                     resources.get("except").get("OSError"))



@app.route('/tags', methods=('GET',))
@with_localization
def tags(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Loads the list of tags"""

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT tag_id, name, used FROM tags;")

        t = [{ "id": i, "name": n, "used": u } for i, n, u in c]

        return t, 200, { "Content-Language": lang }

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/imageTags', methods=('GET',))
@with_localization
def image_tags(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Returns the list of tag ids for an image"""

    fn = request.args.get('fn', None)

    if not fn:
        return abort(400, resources.get("validation").get("not fn"))

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

        tags_list = [x for x, *_ in c]

        return tags_list, 200, { "Content-Language": lang }

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/addTag', methods=('POST',))
@with_localization
def add_tag(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Adds a new tag to the list of available tags"""

    name = request.form.get('name', '')
    description = request.form.get('description', None)

    if not name or not name.strip():
        return abort(400,
                     resources.get("validation").get("not name or not name.strip()"))

    name = name.strip()
    description = (description.strip()
                   if description is not None and description.strip()
                   else None)

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
            "used": 0,
        }, 201, { "Content-Language": lang }

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.IntegrityError"))
    except sqlite3.OperationalError:
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/toggleTags', methods=('POST',))
@with_localization
def toggle_tags(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Toggle tags for image"""

    fn = request.form.get('fn', None)
    tags_data = request.form.get('tags', None)

    if not fn:
        return abort(400, resources.get("validation").get("not fn"))
    if not tags_data:
        return abort(400, resources.get("validation").get("not tags_data"))

    try:
        tags_to_toggle = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, resources.get("except").get("json.JSONDecodeError"))

    is_what_we_expect = {
        'tags': isinstance(tags_to_toggle, list) and tags_to_toggle
    }
    if not is_what_we_expect['tags']:
        return abort(400, resources.get("validation").get("not is_what_we_expect['tags']"))

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

        return list(current_tags ^ set(tags_to_toggle)), 200, { "Content-Language": lang }

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.IntegrityError"))
    except sqlite3.OperationalError:
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/tagInfo', methods=('GET',))
@with_localization
def tag_info(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Returns information on the specified tag"""

    tag_id = request.args.get('tag', None)

    if tag_id is None:
        return abort(400, resources.get("validation").get("tag_id is None"))

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT description, used FROM tags WHERE tag_id = ?;",
                  (tag_id,))
        desc, used = c.fetchone()

        resp = {
            "description": desc,
            "used": used,
            "images": [],
        }

        c.execute("SELECT image_id FROM tagged_images WHERE tag_id = ?;",
                  (tag_id,))

        image_ids = [x for x, *_ in c]
        image_ids = image_ids if len(image_ids) < 4 else random.sample(image_ids, 3)

        c.execute(
            f"SELECT fn FROM images WHERE image_id IN ({', '.join('?' * len(image_ids))});",
            image_ids
        )

        resp["images"] = [fn for fn, *_ in c]

        return resp, 200, { "Content-Language": lang }

    except sqlite3.OperationalError:
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/updateTag', methods=['POST'])
@with_localization
def update_tag(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Updates a tag's name or description (only fields provided)."""

    tag_id = request.form.get('tag_id')
    name = request.form.get('name')
    description = request.form.get('description')

    if tag_id is None:
        return abort(400, resources.get("validation").get("tag_id is None"))

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
            return { "status": "no changes" }, 200, { "Content-Language": lang }

        db.execute("BEGIN")

        params.append(tag_id)
        c.execute(f"UPDATE tags SET {', '.join(fields)} WHERE tag_id = ?;", params)

        db.commit()

        return { "status": "success" }, 200, { "Content-Language": lang }

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.IntegrityError"))
    except sqlite3.OperationalError:
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/deDuplicate', methods=('POST',))
@with_localization
def de_duplicate(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Merge several tags into the first one and remove the redundant ones."""

    tags_data = request.form.get('tags')
    if tags_data is None:
        return abort(400, resources.get("validation").get("tags_data is None"))

    try:
        tags_list = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, resources.get("except").get("json.JSONDecodeError"))

    if not isinstance(tags_list, list):
        return abort(400, resources.get("validation").get("not isinstance(tags_list, list)"))

    if len(tags_list) < 2:
        return abort(400, resources.get("validation").get("len(tags_list) < 2"))

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
            WHERE tag_id IN ({', '.join('?' * len(remove_ids))})
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
            WHERE tag_id IN ({', '.join('?' * len(remove_ids))});
            """,
            (keep_id, *remove_ids)
        )

        # Step 3: Delete the redundant tag rows
        c.execute(
            f"DELETE FROM tags WHERE tag_id IN ({', '.join('?' * len(remove_ids))});",
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

        return {
            "status": "success",
            "kept": keep_id,
            "removed": remove_ids
        }, 200, { "Content-Language": lang }

    except sqlite3.IntegrityError:
        db.rollback()
        current_app.logger.exception('Database Integrity Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.IntegrityError"))
    except sqlite3.OperationalError:
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/deleteTags', methods=('POST',))
@with_localization
def delete_tags(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Delete the tags specified by the "tags" form field"""

    tags_data = request.form.get('tags', None)
    if tags_data is None:
        return abort(400, resources.get("validation").get("tags_data is None"))

    try:
        tags_list = json.loads(tags_data)

    except json.JSONDecodeError:
        return abort(400, resources.get("except").get("json.JSONDecodeError"))

    is_what_we_expect = {
        'tags': isinstance(tags_list, list) and tags_list
    }
    if not is_what_we_expect['tags']:
        return abort(400, resources.get("validation").get("not is_what_we_expect['tags']"))

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        db.execute('BEGIN')

        # Step 1: Delete tags from images
        c.execute(
            f"""
            DELETE FROM tagged_images
            WHERE tag_id IN ({', '.join('?' * len(tags_list))});
            """,
            tags_list
        )

        # Step 2: Delete the actual tags
        c.execute(
            f"DELETE FROM tags WHERE tag_id IN ({', '.join('?' * len(tags_list))});",
            tags_list
        )

        db.commit()

        return {
            "status": "success",
            "removed": tags_list
        }, 200, { "Content-Language": lang }

    except sqlite3.OperationalError:
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()


@app.route('/latest', methods=('GET',))
@with_localization
def latest(lang: str, resources: Mapping[str, Mapping[str, Any]]):
    """Returns the latest image that was tagged"""

    c = None
    try:
        db = _get_db()
        c = db.cursor()

        c.execute("SELECT fn FROM images ORDER BY image_id DESC LIMIT 1;")

        r = c.fetchone()

        if r is not None:
            return { "fn": r[0] }, 200

        return { "fn": None }, 200, { "Content-Language": lang }

    except sqlite3.OperationalError:
        db.rollback()
        current_app.logger.exception('Database Operational Error.')
        return abort(500,
                     resources.get("except").get("sqlite3.OperationalError"))
    finally:
        if c is not None:
            c.close()
