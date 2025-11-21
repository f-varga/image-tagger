# 📸 Simple Flask Image Tagger

A lightweight, hobby project built with **Flask** for demonstrating skills in web development, database management, and UI design (mainly for myself since I don't really expect anyone to look at this app -- and yes, this file was mostly written by an LLM). This application provides an easy way to organize and search your local image collection using customizable tags.

---

## ✨ Features

* **Single Directory Scanning:** Quickly scan and load images from a specified local directory (non-recursive).
* **Large Image Viewer:** A primary viewing frame dedicated to displaying the selected image clearly.
* **Powerful Multi-Tag Search:** Effortlessly find images by searching for **multiple tags** simultaneously.
* **Intuitive Tag Sidebar:**
    * Tags are **sorted by frequency** of use, placing the most relevant tags at the top.
    * A **color temperature indicator** provides a visual cue for tag usage frequency (e.g., "hotter" colors for more frequent tags).
* **Always Visible Tag Form:** Easily add new tags via a simple form located permanently at the bottom of the tag list.
* **Comprehensive Tag Management:**
    * Dedicated **Management Page** for maintaining your tag database.
    * Allows **deletion** of unwanted tags.
    * Includes a **de-duplication** feature to regroup multiple similar tags under a single, preferred tag.

---

## 🛠️ Installation and Setup

### Prerequisites

* Python (3.13 recommended)
* `pip` (Python package installer)

### Steps

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/f-varga/image-tagger.git
    cd image-tagger
    ```

2.  **Create a Virtual Environment (Recommended):**
    ```bash
    python -m venv venv
    source venv/bin/activate
    ```

    On Windows use powershell -- remember to set your execution policy to `RemoteSigned` if you haven't done it already:

    ```powershell
    Set-ExecutionPolicy CurrentUser RemoteSigned
    python -m venv venv
    .\venv\Scripts\activate
    ```

3.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

    To use the content translation feature you should install CUDA (or ROCm - depending on your graphics card manufacturer, unless you don't have a dedicated graphics card or it is not supported by the ollama framework), then install ollama (download and install from [ollama.com](https://ollama.com/)). You will also need to follow the instructions to download and install a model.

    When ollama is up and running, unless you have it installed on the same machine, you will have to configure the server to listen for outside connections (this might also require you to open up the port 11434 - or another port of your choosing for http connections).

4.  **Configuration:**
    * Create a `config.json` file in the project root, with the following values (for Windows you will have to escape the '\' character in paths, since '\' is a special character in JSON):

    ```json
    {
        "DEBUG": false,
        "SECRET_KEY": "192b9bdd22ab9ed4d12e236c78afcb9a393ec15f71bbf5dc987d54727823bcbf",
        "DATABASE": "tags.db3",
        "IMAGES_FOLDER": "C:\\Users\\franc\\Pictures\\Downloaded Wallpapers",
        "OLLAMA_HOST": "127.0.0.1",
        "OLLAMA_PORT": 11434,
        "OLLAMA_MODEL": "gemma3:12b",
        "OLLAMA_TRANSLATE_TAGS_PROMPT": "You are an expert translation assistant. Your task is to translate the 'name' and 'description' fields of the following JSON data from {source_lang} language to {dest_lang}.\n{preferred_translations_notes}\nINPUT:\n```json\n{tags}\n```",
        "OLLAMA_PREFERRED_TRANSLATIONS": {
            "intro": "NOTE:",
            "note": " - whenever you see \"{source_term}\" you should translate it as \"{dest_term}\";",
            "en-fr": [
                ["knick-knack", "truc"],
                ...
            ],
            "fr-en": [
                ...
            ]
        }
    }
    ```

    * The `DATABASE` and `IMAGES_FOLDER` keys are specific to the application:
        * `DATABASE` controls the name of your local database file. If you change this value, rename the `tags.db3` file in the root of the project to the new name or run: `flask --app web init-db` again.
        * `IMAGES_FOLDER` contains the path to a local folder where you store the images you want to tag. This should be a valid path and remember: the application will only look inside this folder and not any of it's subfolders.
        * `OLLAMA_*` configuration keys allow using a running ollama server to do content translation on the fly. All keys except `OLLAMA_PREFERRED_TRANSLATIONS` are required for the configuration to work.
    
    * For the other options, please consult the [flask documentation](https://flask.palletsprojects.com/en/stable/).

5.  **Run the Application:**
    ```bash
    source venv/bin/activate
    flask --app web init-db # only before first run (or whenever 
                            # you want to completely reset your database)
    flask --app web run     # --debug if you want to tinker with the
                            # code and see the effects immediatly
    ```

    or, under Windows:

    ```powershell
    .\venv\Scripts\activate
    flask --app web init-db # only before first run (or whenever 
                            # you want to completely reset your database)
    flask --app web run     # --debug if you want to tinker with the
                            # code and see the effects immediatly
    ```

    The application should now be accessible at `http://127.0.0.1:5000`. If your OS access control or firewall rules prevent the application from running at this port, please consult the documentation provided by your OS vendor / firewall vendor on how to solve this issue or try:

    ```bash
    flask --app web run --port YOUR_PORT_HERE
    ```

6. **Deploying the Application**

    At your own risk, you can deploy the application on a webserver that you own. For instructions on how to deploy flask applications in production environments, consult the [flask documentation](https://flask.palletsprojects.com/en/stable/).

    **Do not** use the above command to deploy the application in a production environment!

---

## 💡 Planned Enhancements

* **🌐 Internationalization / Localization (i18n):** Adding support for multiple languages.
* **🐛 Bug Fixes and Stability Improvements:** Addressing issues found during personal use.

---

## 🤝 Contributing

This is a personal hobby project, but I welcome feedback and suggestions! If you find a bug or have a constructive idea, feel free to open an issue.

Expect some latancy with your issue getting handled, if you're in a hurry just follow the rules of common sense and do the work yourself or pay someone to do it for you. Do not expect to make any profit from using a product that someone is providing for free.

---

## 📄 License

This project is licensed under the **BSD 3-Clause License** - see the [LICENSE.md](LICENSE.md) file for details.
