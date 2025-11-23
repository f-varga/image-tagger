window.onload = () => {

    initImageViewer();
    initPager();
    initAddTag();
    initSearch();
    initFilterTags();

    const images = [];
    const tags = [];
    const tagFilter = {
        "name": null
    };
    const broadcastChannel = new BroadcastChannel("tags");
    const receiveChannel = new BroadcastChannel("tags");

    function formatMessage(template, values) {
        if (template in config.resources) {
            template = config.resources[template];
        }
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return key in values ? values[key] : match;
        });
    }

    function initAddTag() {

        const form = document.getElementById("addTag");
        const contentLangInput = document.getElementById("contentLanguage");
        const nameInput = document.getElementById("tagName");
        const descriptionInput = document.getElementById("tagDescription");
        const container = document.getElementById("tagsContainer");

        contentLangInput.addEventListener("change", () => {
            nameInput.lang = contentLangInput.value;
            descriptionInput.lang = contentLangInput.value;
        });

        form.addEventListener("submit", async (e) => {

            e.preventDefault();

            const name = nameInput.value.trim();
            if (!name) {

                return;
            }

            const description = descriptionInput.value.trim();

            nameInput.value = '';
            descriptionInput.value = '';

            const formData = new FormData();
            formData.append('name', name);
            formData.append('description', description);
            
            const headers = { "Content-Language": contentLangInput.value };

            const resp = await fetch(config.urls.addTag, { method: 'POST', body: formData, headers: headers });

            if (!resp.ok) {
                if (resp.headers.get("Content-Type").startsWith("application/json")) {
                    const info = await resp.json();
                    alertDialog(info.reason);
                } else {
                    alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                }
                nameInput.value = name;
                descriptionInput.value = description;
                return;
            }

            const tag = await resp.json();

            tags.push(tag);

            broadcastChannel.postMessage({
                "type": "tagCreated",
                "details": Object.assign({}, tag, {
                    "lang": tag.lang,
                    "originalName": tag.name,
                    "originalDescription": tag.description
                })
            });

            nameInput.value = '';
            descriptionInput.value = '';

            const index = parseInt(document.getElementById("pagerCrt").textContent) - 1;
            const fn = images[index];

            translateAddedTag(tag)

            toggleAddedTag(fn, tag);
        });

        async function toggleAddedTag(fn, tag) {

            const formData = new FormData();
            formData.append("fn", fn);
            formData.append("tags", JSON.stringify([tag.id]));

            const resp = await fetch(config.urls.toggleTags, { method: 'POST', body: formData });

            if (!resp.ok) {
                if (resp.headers.get("Content-Type").startsWith("application/json")) {
                    const info = await resp.json();
                    alertDialog(info.reason);
                } else {
                    alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                }
                return;
            }

            const toggled = (await resp.json()).some(t => t == tag.id);

            if (!toggled) {
                alertDialog("toggleAddedTag.fail", { tag: tag.name, fn: fn });
            }

            tag.used += 1;
            tags.sort((a, b) => {
                if (b.used !== a.used) {
                    return b.used - a.used;
                }
                return a.name.localeCompare(b.name);
            });

            requestAnimationFrame(() => {
                const maxUsed = Math.max(...tags.map(t => t.used));
                container.appendChild(buildContainerTag(tag, maxUsed, toggled));
                const elementMap = new Map(
                    Array.from(container.children).map(el => [parseInt(el.dataset["tagId"]), el])
                );
                tags.forEach(t => {
                    const el = elementMap.get(t.id);
                    const hue = 240 - (240 * (t.used / maxUsed));
                    if (el) {
                        el.style.setProperty("--tag-color", `hsl(${hue}, 80%, 92%)`);
                        container.appendChild(el);
                    }
                });
            });
        }

        async function translateAddedTag(tag) {

            if (config.apiNotConfigured) {
                return;
            }
            
            const headers = { "Content-Language": contentLangInput.value };

            for (const opt of contentLangInput.querySelectorAll('option')) {
                if (opt.value === '' || opt.value === contentLangInput.value) {
                    continue;
                }
                const formData = new FormData();
                formData.append("tags", JSON.stringify([{ "id": tag.id, "name": tag.name, "description": tag.description }]));
                formData.append("sourceLang", contentLangInput.value);
                formData.append("destLang", opt.value);

                const resp = await fetch(config.urls.translateTags, { method: 'POST', body: formData, headers: headers });

                if (!resp.ok) {
                    if (resp.headers.get("Content-Type").startsWith("application/json")) {
                        const info = await resp.json();
                        await alertDialog(info.reason);
                    } else {
                        alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                    }
                    continue;
                }

                const details = await resp.json();
                if (details.status !== "success") {
                    continue;
                }

                for (const tag of details.translated) {
                    broadcastChannel.postMessage({
                        "type": "tagUpdated",
                        "details": {
                            "tagId": tag.id,
                            "field": "name",
                            "newValue": tag.name,
                            "lang": opt.value
                        }
                    });
                    requestAnimationFrame(() => broadcastChannel.postMessage({
                        "type": "tagUpdated",
                        "details": {
                            "tagId": tag.id,
                            "field": "description",
                            "newValue": tag.description,
                            "lang": opt.value
                        }
                    }));
                }
            }
        }
    }

    async function initTags() {

        const resp = await fetch(config.urls.tags);

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
            }
            return;
        }

        tags.length = 0;
        tags.push(...await resp.json());
        tags.sort((a, b) => {
            if (b.used !== a.used) {
                return b.used - a.used;
            }
            return a.name.localeCompare(b.name);
        });

        const container = document.getElementById("tagsContainer");
        const maxUsed = Math.max(...tags.map(t => t.used));
        const fragment = document.createDocumentFragment();
        for (const t of tags) {
            const div = buildContainerTag(t, maxUsed);
            fragment.appendChild(div);
        }

        container.replaceChildren(fragment);

        receiveChannel.onmessage = e => {

            const { type, details } = e.data;
            if (type === "tagsRemoved" && details.status === "success") {
                for (const tagId of details.removed) {
                    const ix = tags.findIndex(t => t.id == tagId);
                    if (ix < 0) {
                        continue;
                    }
                    tags.splice(ix, 1);
                    const el = container.querySelector(`div[data-tag-id="${tagId}"]`);
                    if (el) {
                        el.remove();
                    }
                }
            }

            if (type === "tagsMerged" && details.status === "success") {
                const kept = tags.find(t => t.id === details.kept);
                if (!kept) {
                    return;
                }
                const removed = [];
                for (const tagId of details.removed) {
                    const ix = tags.findIndex(t => t.id == tagId);
                    if (ix < 0) {
                        continue;
                    }
                    removed.push(...tags.splice(ix, 1));
                    const el = container.querySelector(`div[data-tag-id="${tagId}"]`);
                    if (el) {
                        el.remove();
                    }
                }
                kept.used += removed.reduce((p, c) => p + c.used, 0);
                tags.sort((a, b) => {
                    if (b.used !== a.used) {
                        return b.used - a.used;
                    }
                    return a.name.localeCompare(b.name);
                });
                requestAnimationFrame(() => {
                    const elementMap = new Map(
                        Array.from(container.children).map(el => [parseInt(el.dataset["tagId"]), el])
                    );
                    const maxUsed = Math.max(...tags.map(t => t.used));
                    tags.forEach(tag => {
                        const el = elementMap.get(tag.id);
                        const hue = 240 - (240 * (t.used / maxUsed));
                        if (el) {
                            el.style.setProperty("--tag-color", `hsl(${hue}, 80%, 92%)`);
                            container.appendChild(el);
                        }
                    });
                });
            }

            if (type === "tagUpdated" && details.lang == config.lang) {
                const updated = tags.find(t => t.id === details.tagId);
                if (!updated) {
                    return;
                }
                if (details.field !== "name") {
                    return;
                }
                updated.name = details.newValue;
                const el = container.querySelector(`div[data-tag-id="${details.tagId}"] label`);
                if (!el) {
                    return;
                }
                const infoIcon = el.firstChild;
                el.replaceChildren(infoIcon, document.createTextNode(details.newValue));
            }
        };


        loadImageTags();

        let top = null, tor = null;
        let pending = {};

        container.addEventListener("change", (e) => {

            const index = parseInt(document.getElementById("pagerCrt").textContent) - 1;
            const fileName = images[index];
            const tagId = parseInt(e.target.closest('.tag-wrapper').dataset["tagId"]);

            for (const t of tags) {

                if (t.id !== tagId) {
                    continue;
                }

                t.used += e.target.checked ? 1 : -1;
            }
            tags.sort((a, b) => {
                if (b.used !== a.used) {
                    return b.used - a.used;
                }
                return a.name.localeCompare(b.name);
            });

            if (tor) {
                clearTimeout(tor);
            }

            setTimeout(() => {
                const elementMap = new Map(
                    Array.from(container.children).map(el => [parseInt(el.dataset["tagId"]), el])
                );
                const maxUsed = Math.max(...tags.map(t => t.used));
                tags.forEach(tag => {
                    const el = elementMap.get(tag.id);
                    const hue = 240 - (240 * (tag.used / maxUsed));
                    if (el) {
                        el.style.setProperty("--tag-color", `hsl(${hue}, 80%, 92%)`);
                        container.appendChild(el);
                    }
                });
            }, 3e3);

            if (!pending[fileName]) {
                pending[fileName] = [tagId];
            } else if (pending[fileName].indexOf(tagId) >= 0 && pending[fileName].length > 1) {
                const ix = pending[fileName].indexOf(tagId);
                pending[fileName].splice(ix, 1);
            } else if (pending[fileName].indexOf(tagId) >= 0 && pending[fileName].length === 1) {
                delete pending[fileName];
            } else {
                pending[fileName].push(tagId)
            }

            if (top) {
                clearTimeout(top);
            }

            top = setTimeout(async () => {

                let p = pending;
                pending = {};
                top = null;

                for (const fn of Object.keys(p)) {

                    const formData = new FormData();
                    formData.append("fn", fn);
                    formData.append("tags", JSON.stringify(p[fn]));

                    const resp = await fetch(config.urls.toggleTags, { method: 'POST', body: formData });

                    if (!resp.ok) {
                        if (resp.headers.get("Content-Type").startsWith("application/json")) {
                            const info = await resp.json();
                            alertDialog(info.reason);
                        } else {
                            alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                        }
                        continue;
                    }

                    document.dispatchEvent(new CustomEvent("tagsUpdated", {
                        detail: {
                            "fn": fn,
                            "tags": await resp.json()
                        }
                    }));
                }
            }, 5e3);
        });

        let hoverId = null, tof = null;
        container.addEventListener("mouseover", (e) => {
            if (!e.target.classList.contains('info-icon')) {
                return;
            }

            const wrapper = e.target.closest('.tag-wrapper');
            const hid = wrapper.dataset["tagId"];
            if (hoverId !== hid) {
                if (tof) {
                    clearTimeout(tof);
                }
                hoverId = hid;
            }

            const respPromise = fetch(config.urls.tagInfo.concat("?tag=", encodeURIComponent(hoverId)));
            let flyout = document.getElementById('flyout');

            tof = setTimeout(async () => {
                const resp = await respPromise;
                if (!resp.ok) {
                    if (resp.headers.get("Content-Type").startsWith("application/json")) {
                        const info = await resp.json();
                        alertDialog(info.reason);
                    } else {
                        alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                    }
                    return;
                }

                const info = await resp.json();

                if (!flyout) {
                    flyout = document.createElement('div');
                    flyout.setAttribute('id', 'flyout');
                    const bw = document.createElement('div');
                    bw.classList.add('bubble-wrapper');
                    const samples = document.createElement('div');
                    samples.classList.add('sample-images');
                    bw.appendChild(samples);
                    const desc = document.createElement('div');
                    desc.classList.add('tag-description');
                    bw.appendChild(desc);
                    flyout.appendChild(bw);
                    document.body.appendChild(flyout);
                }

                flyout.querySelector('.sample-images').replaceChildren(...info.images.map(fn => {
                    const img = document.createElement('div');
                    img.classList.add('sample-image');
                    img.style.backgroundImage = `url("${config.urls.loadImage}?fn=${encodeURIComponent(fn)}&tn=true")`;

                    return img;
                }));
                flyout.querySelector('.tag-description').replaceChildren(...info.description.split('\r\n').flatMap(ln => [
                    document.createElement('br'),
                    document.createTextNode(ln)
                ]).splice(1))
                flyout.style.display = 'block';

                requestAnimationFrame(() => {
                    const rect = wrapper.getBoundingClientRect();
                    flyout.style.top = `${rect.top}px`;
                    flyout.style.left = `${rect.left - flyout.offsetWidth - 8}px`;
                });

                tof = setTimeout(() => {
                    document.getElementById('flyout').style.display = 'none';
                }, 7e3);
            }, flyout && flyout.style.display == 'block' ? 100 : 1e3);
        });

        container.addEventListener("mouseout", (e) => {
            if (!e.target.classList.contains('info-icon')) {
                return;
            }

            if (tof) {
                clearTimeout(tof);
                tof = null;
                hoverId = null;
            }

            const flyout = document.getElementById('flyout');

            if (!flyout || flyout.style.display === 'none') {
                return;
            }

            tof = setTimeout(() => {
                flyout.style.display = 'none';
                tof = null;
                hoverId = null;
            }, 100);
        });

        container.addEventListener("scroll", () => {

            if (tof) {
                clearTimeout(tof);
                tof = null;
                hoverId = null;
            }

            const flyout = document.getElementById('flyout');

            if (!flyout || flyout.style.display === 'none') {
                return;
            }

            tof = setTimeout(() => {
                flyout.style.display = 'none';
                tof = null;
                hoverId = null;
            }, 50);
        });
    }

    function buildContainerTag(tag, maxUsed, checked = false) {

        const hue = 240 - (240 * (tag.used / maxUsed));
        const div = document.createElement('div');
        div.className = 'tag-wrapper';
        div.style.setProperty("--tag-color", `hsl(${hue}, 80%, 92%)`);
        div.dataset["tagId"] = tag.id.toFixed(0);
        if (tagFilter.name) {
            div.style.display = tag.name.search(tagFilter.name) < 0 ? 'none' : '';
        }
        const label = document.createElement('label');
        label.setAttribute("for", `tag_${tag.id}`);
        const info = document.createElement('i');
        info.className = 'info-icon';
        label.appendChild(info);
        label.appendChild(document.createTextNode(tag.name));
        div.appendChild(label);
        const input = document.createElement('input');
        input.setAttribute("type", "checkbox");
        input.setAttribute("id", `tag_${tag.id}`);
        input.setAttribute("name", `tag_${tag.id}`);
        input.checked = checked;
        div.appendChild(input);

        return div;
    }

    async function loadImageTags() {

        const index = parseInt(document.getElementById("pagerCrt").textContent) - 1;
        const fn = images[index];

        const resp = await fetch(config.urls.imageTags.concat("?fn=", encodeURIComponent(fn)));

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"));
            }
            return;
        }

        const imageTags = await resp.json();

        if (imageTags.length === 0) {
            document.getElementById("tagsContainer").scroll({ top: 0, behavior: "smooth" });
        }

        for (const input of document.querySelectorAll("#tagsContainer input")) {

            input.checked = imageTags.indexOf(parseInt(input.closest('.tag-wrapper').dataset["tagId"])) >= 0;
        }
    }

    const crtImgProp = { naturalWidth: 0, naturalHeight: 0 };
    async function initImageViewer() {

        const resp = await fetch(config.urls.images);

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
            }
            return;
        }

        images.length = 0;
        images.push(...await resp.json());

        const viewer = document.getElementById('imageContainer');

        document.getElementById('pagerCrt').textContent = '1';
        document.getElementById('pagerAll').textContent = images.length.toFixed(0);
        document.getElementById('pagerPrevious').disabled = true;
        document.getElementById('pagerNext').disabled = images.length < 2;

        const imageUrl = `${config.urls.loadImage}?fn=${encodeURIComponent(images[0])}`;

        viewer.style.backgroundImage = `url("${imageUrl}")`;

        // Zoom in on mouse move
        viewer.addEventListener("mousemove", (ev) => {
            const rect = viewer.getBoundingClientRect();
            const OFFSET_X = 50;
            const OFFSET_Y = 100;

            // Mouse position inside element (0–1 range)
            const relX = (ev.clientX - rect.left) / rect.width;
            const relY = (ev.clientY - rect.top) / rect.height;

            const imageRatio = crtImgProp.naturalWidth / crtImgProp.naturalHeight;
            const boxRatio   = rect.width / rect.height;

            let normX = relX;
            let normY = relY;

            if (imageRatio > boxRatio) {
                // Image is wider than the box → width fits, height letterboxes
                // → vertical motion should be amplified
                const scale = imageRatio / boxRatio; // > 1
                normY = 0.5 + (relY - 0.5) * scale;
            } else {
                // Image is taller → height fits, width letterboxes
                // → horizontal motion amplified
                const scale = boxRatio / imageRatio; // > 1
                normX = 0.5 + (relX - 0.5) * scale;
            }

            // Clamp to avoid overshoot beyond 0–1
            normX = Math.min(1, Math.max(0, normX));
            normY = Math.min(1, Math.max(0, normY));

            const dirX = (normX - 0.5) * 2;
            const dirY = (normY - 0.5) * 2;

            // Calculate zoomed background size so it fits natural dimensions
            // (Or: multiply by a fixed zoom factor)
            const zoomWidth = crtImgProp.naturalWidth;
            const zoomHeight = crtImgProp.naturalHeight;

            viewer.style.backgroundSize = `${zoomWidth}px ${zoomHeight}px`;

            const offsetX = dirX * (OFFSET_X / rect.width) * 100;
            const offsetY = dirY * (OFFSET_Y / rect.height) * 100;

            // Convert mouse position to background-position percentage
            const posX = normX * 100 + offsetX;
            const posY = normY * 100 + offsetY;

            viewer.style.backgroundPosition = `${posX}% ${posY}%`;

            viewer.style.cursor = "zoom-in";
        });

        // Reset on mouse leave
        viewer.addEventListener("mouseleave", () => {
            viewer.style.backgroundSize = "contain";
            viewer.style.backgroundPosition = "center center";
        });

        const img = new Image();
        img.src = imageUrl;
        img.onload = () => {
            crtImgProp.naturalWidth = img.naturalWidth;
            crtImgProp.naturalHeight = img.naturalHeight;
        };

        initTags();
    }

    async function initPager() {

        const next = document.getElementById('pagerNext');
        const previous = document.getElementById('pagerPrevious');
        const crt = document.getElementById('pagerCrt');
        const imageContainer = document.getElementById('imageContainer');
        const jump = document.getElementById('pagerJump');

        const changeImage = (imageUrl) => {
            imageContainer.style.backgroundImage = `url("${imageUrl}")`;

            const img = new Image();
            img.src = imageUrl;
            img.onload = () => {
                crtImgProp.naturalWidth = img.naturalWidth;
                crtImgProp.naturalHeight = img.naturalHeight;
            };
        };

        next.addEventListener('click', async () => {

            const index = parseInt(crt.textContent);

            changeImage(`${config.urls.loadImage}?fn=${encodeURIComponent(images[index])}`);

            crt.textContent = (index + 1).toFixed(0);

            previous.disabled = index <= 0;
            next.disabled = index + 1 >= images.length;
            jump.disabled = !jump.dataset["latest"] || images[index] === jump.dataset["latest"] || images.indexOf(jump.dataset["latest"]) < 0;

            loadImageTags();
        });

        previous.addEventListener('click', async () => {

            const index = parseInt(crt.textContent) - 2;

            changeImage(`${config.urls.loadImage}?fn=${encodeURIComponent(images[index])}`);

            crt.textContent = (index + 1).toFixed(0);

            previous.disabled = index <= 0;
            next.disabled = index + 1 >= images.length;
            jump.disabled = !jump.dataset["latest"] || images[index] === jump.dataset["latest"] || images.indexOf(jump.dataset["latest"]) < 0;

            loadImageTags();
        });

        const resp = await fetch(config.urls.latest);

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
            }
            return;
        }

        const latest = await resp.json();
        if (latest.fn === null) {
            jump.disabled = true;
            return
        }

        jump.dataset["latest"] = latest.fn;
        jump.addEventListener('click', () => {
            delete jump.dataset["latest"];

            const index = images.indexOf(latest.fn);
            
            changeImage(`${config.urls.loadImage}?fn=${encodeURIComponent(images[index])}`);

            crt.textContent = (index + 1).toFixed(0);

            previous.disabled = index <= 0;
            next.disabled = index + 1 >= images.length;
            jump.disabled = true;

            loadImageTags();
        }, { once: true });
    }

    function initSearch() {

        const input = document.getElementById("searchInput");
        const suggestions = document.getElementById("tagSuggestions");
        const searchBar = document.querySelector(".search-bar");
        const next = document.getElementById('pagerNext'),
            previous = document.getElementById('pagerPrevious'),
            crt = document.getElementById('pagerCrt'),
            imageContainer = document.getElementById('imageContainer'),
            jump = document.getElementById('pagerJump'),
            all = document.getElementById('pagerAll');

        input.addEventListener("keydown", e => {

            if (e.key === "ArrowUp") {
                e.preventDefault();
                let found = null, hov = null;
                for (const el of Array.from(suggestions.querySelectorAll('div')).toReversed().values()) {
                    if (el.matches('.highlight')) {
                        found = el;
                    } else if (found && found.matches('.highlight')) {
                        found.classList.toggle('highlight');
                        el.classList.toggle('highlight');
                        if (!input.dataset["history"]) {
                            input.dataset["history"] = input.value;
                        }
                        input.value = el.textContent;
                        input.selectionStart = input.value.length;
                        break;
                    }
                }
                for (const el of Array.from(suggestions.querySelectorAll('div')).toReversed().values()) {
                    if (el.matches(':hover')) {
                        hov = el;
                    } else if (!found && hov) {
                        found = hov;
                        el.classList.toggle('highlight');
                        if (!input.dataset["history"]) {
                            input.dataset["history"] = input.value;
                        }
                        input.value = el.textContent;
                        input.selectionStart = input.value.length;
                        break;
                    }
                }
                if (!found) {
                    const el = suggestions.querySelector('div:last-child');
                    if (el) {
                        el.classList.toggle('highlight');
                        if (!input.dataset["history"]) {
                            input.dataset["history"] = input.value;
                        }
                        input.value = el.textContent;
                        input.selectionStart = input.value.length;
                    }
                }
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                let found = null, hov = null;
                for (const el of suggestions.querySelectorAll('div')) {
                    if (el.matches('.highlight')) {
                        found = el;
                    } else if (found && found.matches('.highlight')) {
                        found.classList.toggle('highlight');
                        el.classList.toggle('highlight');
                        if (!input.dataset["history"]) {
                            input.dataset["history"] = input.value;
                        }
                        input.value = el.textContent;
                        input.selectionStart = input.value.length;
                        break;
                    }
                }
                for (const el of suggestions.querySelectorAll('div')) {
                    if (el.matches(':hover')) {
                        hov = el;
                    } else if (!found && hov) {
                        found = hov;
                        el.classList.toggle('highlight');
                        if (!input.dataset["history"]) {
                            input.dataset["history"] = input.value;
                        }
                        input.value = el.textContent;
                        input.selectionStart = input.value.length;
                        break;
                    }
                }
                if (!found) {
                    const el = suggestions.querySelector('div:first-child');
                    if (el) {
                        el.classList.toggle('highlight');
                        if (!input.dataset["history"]) {
                            input.dataset["history"] = input.value;
                        }
                        input.value = el.textContent;
                        input.selectionStart = input.value.length;
                    }
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                const suggestion = suggestions.querySelector('div.highlight');
                if (suggestion && suggestion.textContent == input.value) {
                    addTagToBar(suggestion.dataset["tagId"], suggestion.textContent);
                    if (input.dataset["history"]) {
                        delete input.dataset["history"];
                    }
                    input.value = '';
                    suggestions.hidePopover();
                    suggestions.replaceChildren();
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                for (const el of suggestions.querySelectorAll('.highlight')) {
                    el.classList.toggle('highlight');
                }
                if (input.dataset["history"]) {
                    input.value = input.dataset["history"];
                    delete input.dataset["history"];
                } else {
                    input.value = '';
                    suggestions.hidePopover();
                    suggestions.replaceChildren();
                }
            } else if (e.key === "Backspace") {
                if (input.selectionStart === 0 && input.selectionEnd == 0) {
                    const st = searchBar.querySelector(".search-tag:last-of-type");
                    if (st) {
                        st.remove();
                        search();
                    }
                }
            } // else handle the event normally
        });

        input.addEventListener("input", () => {
            const query = input.value.trim().toLowerCase();
            
            if (!query || query.length < 3) {
                suggestions.hidePopover();
                return;
            }

            const matches = tags.filter(t => t.name.toLowerCase().includes(query));
            if (matches.length === 0) {
                suggestions.hidePopover();
                return;
            }

            const fragment = document.createDocumentFragment();
            let highlighted = false;
            for (const t of matches) {
                const div = document.createElement("div");
                div.textContent = t.name;
                if (t.name === query && !highlighted) {
                    div.className = "highlight";
                    highlighted = true;
                }
                div.dataset["tagId"] = t.id;
                fragment.appendChild(div);
            }

            suggestions.replaceChildren(fragment);
            suggestions.showPopover();
            // position near the input
            const rect = searchBar.getBoundingClientRect(); // position below entire bar
            suggestions.style.left = `${rect.left + window.scrollX}px`;
            suggestions.style.top = `${rect.bottom + window.scrollY + 4}px`;
            suggestions.style.width = `${rect.width}px`;
        });

        suggestions.addEventListener("mouseover", e => {
            if (!e.target.dataset["tagId"]) {
                return;
            }
            const highlight = suggestions.querySelector('.highlight');
            if (highlight && highlight != e.target) {
                e.preventDefault();
                highlight.classList.toggle('highlight');
                e.target.classList.toggle('highlight');
                input.value = e.target.textContent;
            }
        });

        suggestions.addEventListener("click", e => {
            if (!e.target.dataset["tagId"]) {
                return;
            }
            addTagToBar(e.target.dataset["tagId"], e.target.textContent);
            if (input.dataset["history"]) {
                delete input.dataset["history"];
            }
            input.value = "";
            suggestions.hidePopover();
        });

        function addTagToBar(id, name) {
            if (searchBar.querySelector(`[data-tagId="${id}"]`)) {
                return;
            }

            const tag = document.createElement("div");
            tag.className = "search-tag";
            tag.dataset["tagId"] = id;
            tag.innerHTML = `${name}<span>&#x00D7;</span>`;
            searchBar.insertBefore(tag, input);

            search();
        }

        document.addEventListener("tagsUpdated", e => {
            const { fn, tags } = e.detail;

            const index = images.indexOf(fn);
            if (index < 0) {
                return;
            }

            const searchTags = Array.from(
                searchBar.querySelectorAll('.search-tag')
            ).map(
                el => parseInt(el.dataset["tagId"])
            );

            if (searchTags.some(t => tags.indexOf(t) < 0)) {

                images.splice(index, 1);

                const crtIndex = parseInt(crt.textContent) - 1;
                let newIndex = crtIndex;

                if (index < crtIndex) {
                    newIndex = crtIndex - 1;
                    previous.disabled = (newIndex - 1) < 0;
                }

                if (newIndex >= images.length) {
                    newIndex -= 1;
                }

                crt.textContent = (newIndex + 1).toFixed(0);
                all.textContent = images.length.toFixed(0);
                next.disabled = (newIndex + 1) >= images.length;

                if (index === crtIndex) {
                    imageContainer.style.backgroundImage = 'url("'.concat(config.urls.loadImage, '?fn=', encodeURIComponent(images[newIndex]), '")');
                    loadImageTags();
                }
            }
        });

        async function search() {

            const index = parseInt(crt.textContent) - 1;
            const fn = images[index];

            const tagIds = Array.from(
                searchBar.querySelectorAll('.search-tag')
            ).map(
                el => parseInt(el.dataset["tagId"])
            );

            if (tagIds.length > 0) {

                const formData = new FormData();
                formData.append('tags', JSON.stringify(tagIds));

                const resp = await fetch(config.urls.searchImages, { method: 'POST', body: formData });

                if (!resp.ok) {
                    if (resp.headers.get("Content-Type").startsWith("application/json")) {
                        const info = await resp.json();
                        alertDialog(info.reason);
                    } else {
                        alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                    }
                    return;
                }

                images.length = 0;
                images.push(...await resp.json());

                jump.disabled = true;
            } else {

                const resp = await fetch(config.urls.images);

                if (!resp.ok) {
                    if (resp.headers.get("Content-Type").startsWith("application/json")) {
                        const info = await resp.json();
                        alertDialog(info.reason);
                    } else {
                        alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                    }
                    return;
                }

                images.length = 0;
                images.push(...await resp.json());

                jump.disabled = !jump.dataset["latest"] || images[0] === jump.dataset["latest"] || images.indexOf(jump.dataset["latest"]) < 0;
            }

            const newIndex = images.indexOf(fn);

            if (newIndex < 0) {
                crt.textContent = '1';
                previous.disabled = true;
                next.disabled = images.length < 2;
                imageContainer.style.backgroundImage = 'url("'.concat(config.urls.loadImage, '?fn=', encodeURIComponent(images[0]), '")');
            } else {
                crt.textContent = (newIndex + 1).toFixed(0);
                previous.disabled = newIndex <= 0;
                next.disabled = newIndex + 1 >= images.length;
            }
            all.textContent = images.length.toFixed(0);

            loadImageTags();
        }

        searchBar.addEventListener("click", e => {
            if (e.target.tagName.toUpperCase() === "SPAN" && e.target.parentElement.classList.contains("search-tag")) {
                e.target.parentElement.remove();
                search();
            }
        });

        // hide suggestions when clicking outside
        document.addEventListener("click", e => {
            if (!searchBar.contains(e.target) && !suggestions.contains(e.target)) {
                suggestions.hidePopover();
            }
        });

        window.addEventListener("message", e => {
            if (e.origin != origin) {
                return;
            }

            const { type, details } = e.data;

            if (type === "tagUpdated" && details.lang == config.lang && details.field === "name") {
                const el = searchBar.querySelector(`div[data-tag-id="${details.tagId}"]`);
                if (el) {
                    el.replaceChildren(
                        document.createTextNode(details.newValue),
                        el.lastChild
                    );
                }
            }

            if (type === "tagsRemoved" && details.status === "success") {
                let removed = false;
                for (const tagId of details.removed) {
                    const el = searchBar.querySelector(`div[data-tag-id="${tagId}"]`);
                    if (!el) {
                        continue;
                    }
                    el.remove();
                    removed = true;
                }
                if (removed) {
                    search();
                }
            }

            if (type === "tagsMerged" && details.status === "success") {
                let removed = false;
                for (const tagId of details.removed) {
                    const el = searchBar.querySelector(`div[data-tag-id="${tagId}"]`);
                    if (!el) {
                        continue;
                    }
                    el.remove();
                    removed = true;
                }
                if (removed) {
                    const el = searchBar.querySelector(`div[data-tag-id="${details.kept}"]`);
                    const tag = tags.find(t => t.id === details.kept);
                    if (!el) {
                        addTagToBar(tag.id, tag.name);
                    } else {
                        search();
                    }
                }
            }
        });
    }

    function initFilterTags() {

        const input = document.getElementById('filterTags');
        const clr = document.getElementById('clearTagsFilter');
        const container = document.getElementById('tagsContainer');

        const toggleClr = () => { clr.style.display = input.value ? 'block' : 'none'; };

        const centermostTag = () => {

            const containerRect = container.getBoundingClientRect();
            const centerY = containerRect.top + containerRect.height / 2;
            const hasChecked = [...container.querySelectorAll('input:checked')].some(c => c.closest('.tag-wrapper').offsetParent != null);
            let best = null;
            let bestDist = Infinity;

            for (const tag of [...container.querySelectorAll('.tag-wrapper')].filter(t => t.offsetParent != null)) {

                if (hasChecked && !tag.querySelector('input:checked')) {
                    continue;
                }

                const r = tag.getBoundingClientRect();
                const tagCenter = r.top + r.height / 2;
                const dist = Math.abs(tagCenter - centerY);

                if (dist < bestDist) {
                    best = tag;
                    bestDist = dist;
                }
            }

            return best;
        };
        const applyFlt = () => {

            const newVal = input.value.length > 2 ? input.value : null;
            const oldVal = tagFilter.name;
            tagFilter.name = newVal;

            if (newVal === oldVal) {
                return;
            }

            const tagToKeepInView = centermostTag();

            if (tagToKeepInView) {
                const tr = tagToKeepInView.getBoundingClientRect();
                const cr = container.getBoundingClientRect();
                const oldTop = tr.top - cr.top;

                if (newVal === null) {
                    requestAnimationFrame(() => {
                        const tr = tagToKeepInView.getBoundingClientRect();
                        const cr = container.getBoundingClientRect();
                        const newTop = tr.top - cr.top;

                        container.scrollBy({ top: newTop - oldTop, behavior: "instant" });
                    });
                }
            }

            const flt = tags.filter(t => tagFilter.name === null || t.name.search(tagFilter.name) >= 0).map(t => t.id);
            for (const el of container.querySelectorAll('.tag-wrapper')) {
                const tagId = parseInt(el.dataset["tagId"]);
                el.style.display = flt.indexOf(tagId) < 0 ? 'none' : '';
            }
        };

        input.addEventListener('keyup', e => {

            if (e.key === 'Escape') {
                input.value = '';
                e.preventDefault();
            }

            toggleClr();

            requestAnimationFrame(applyFlt);
        });

        clr.addEventListener('click', () => {
            input.value = '';
            toggleClr();

            requestAnimationFrame(() => (applyFlt(), input.focus()));
        });

        toggleClr();
    }
};