DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS tagged_images;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS tags_en;
DROP TABLE IF EXISTS tags_fr;

CREATE TABLE images (
    image_id INTEGER PRIMARY KEY AUTOINCREMENT,
    fn TEXT UNIQUE NOT NULL
);

CREATE TABLE tagged_images (
    image_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (image_id, tag_id)
);

CREATE TABLE tags (
    tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    used INTEGER,
    lang TEXT NOT NULL
);

CREATE TABLE tags_en (
    tag_id INTEGER PRIMARY KEY NOT NULL,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE tags_fr (
    tag_id INTEGER PRIMARY KEY NOT NULL,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);
