window.onload = () => {

    const container = document.getElementById('tagsContainer');
    const retranBtn = document.getElementById('retranBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const deduplBtn = document.getElementById('deduplBtn');
    const broadcastChannel = new BroadcastChannel("tags");
    const receiveChannel = new BroadcastChannel("tags");
    const tags = [];

    async function buildTagRow(tag) {

        const row = document.createElement('div');
        row.className = 'wrapper tag-row';
        row.dataset["tagId"] = tag.id.toFixed(0);
        row.dataset["lang"] = tag.lang;
        row.dataset["origName"] = tag.originalName;
        row.dataset["origDesc"] = tag.originalDescription;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tag-checkbox';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'tag-name';
        nameDiv.textContent = tag.name;
        nameDiv.dataset["used"] = tag.used.toFixed(0);

        const descDiv = document.createElement('div');
        descDiv.className = 'tag-description';
        descDiv.replaceChildren(...tag.description.split('\r\n').flatMap(ln => [
            document.createElement('br'),
            document.createTextNode(ln)
        ]).splice(1));

        const imgDiv = document.createElement('div');
        imgDiv.className = 'tag-images';

        const resp = await fetch(`${config.urls.tagInfo}?tag=${tag.id}`);

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
        descDiv.replaceChildren(...info.description.split('\r\n').flatMap(ln => [
            document.createElement('br'),
            document.createTextNode(ln)
        ]).splice(1));

        for (const fn of info.images) {
            const img = document.createElement('div');
            img.style.backgroundImage = `url("${config.urls.loadImage}?fn=${encodeURIComponent(fn)}&tn=true")`;
            imgDiv.appendChild(img);
        }

        row.append(checkbox, nameDiv, descDiv, imgDiv);

        return row;
    }

    receiveChannel.onmessage = async e => {

        console.log("received:", e.data);
        const { type, details } = e.data;
        if (type === "tagCreated") {
            const row = await buildTagRow(details);
            container.appendChild(row);
        }
        if (type === "tagUpdated") {
            if (details.field === "name") {
                const el = container.querySelector(`div[data-tag-id="${details.tagId}"] .tag-name`);
                if (!el) {
                    return;
                }
                el.textContent = details.newValue;
            }
            if (details.field === "description") {
                const el = container.querySelector(`div[data-tag-id="${details.tagId}"] .tag-description`);
                if (!el) {
                    return;
                }
                el.replaceChildren(...details.newValue.split('\r\n').flatMap(ln => [
                    document.createElement('br'),
                    document.createTextNode(ln)
                ]).splice(1))
            }
        }
    };

    function makeEditable(element, field, tagId) {

        if (element.querySelector('input, textarea')) {
            return;
        }

        const oldValue = element.textContent;
        const input = document.createElement(field === 'name' ? 'input' : 'textarea');
        input.className = 'editable';
        input.value = oldValue;
        element.replaceChildren(input);
        input.focus();

        const save = async () => {
            const newValue = input.value.trim();

            if (field === 'name') {
                element.textContent = newValue;
            } else if (field === 'description') {
                element.replaceChildren(...newValue.split('\r\n').flatMap(ln => [
                    document.createElement('br'),
                    document.createTextNode(ln)
                ]).splice(1));
            }

            if (newValue !== oldValue) {
                const formData = new FormData();
                formData.append('tag_id', tagId);
                formData.append(field, newValue);

                const resp = await fetch(config.urls.updateTag, { method: 'POST', body: formData });

                if (!resp.ok) {
                    if (resp.headers.get("Content-Type").startsWith("application/json")) {
                        const info = await resp.json();
                        alertDialog(info.reason);
                    } else {
                        alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
                    }
                    return;
                }

                broadcastChannel.postMessage({
                    "type": "tagUpdated",
                    "details": {
                        "tagId": tagId,
                        "field": field,
                        "newValue": newValue
                    }
                });
            }
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                input.value = oldValue;
                input.blur();
            }

            if (e.key === 'Enter' && field === 'name') {
                e.preventDefault();
                input.blur();
            }
        });
    }

    const selected = [];
    const translatable = [];
    container.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"]')) {
            const row = e.target.closest('.tag-row');
            const tagId = parseInt(row.dataset["tagId"]);
            const lang = row.dataset["lang"];
            if (e.target.checked && selected.indexOf(tagId) < 0) {
                selected.push(tagId);
                if (lang !== config.lang && translatable.indexOf(tagId) < 0) {
                    translatable.push(tagId);
                }
            } else if (!e.target.checked) {
                let ix = selected.indexOf(tagId);
                while (ix >= 0) {
                    selected.splice(ix, 1);
                    ix = selected.indexOf(tagId);
                }

                ix = translatable.indexOf(tagId);
                while (ix >= 0) {
                    translatable.splice(ix, 1);
                    ix = translatable.indexOf(tagId);
                }
            }
        }
        retranBtn.disabled = translatable.length < 1;
        deduplBtn.disabled = selected.length < 2;
        deleteBtn.disabled = selected.length < 1;
    });

    container.addEventListener('click', (e) => {

        const row = e.target.closest('.tag-row');
        if (!row) {
            return;
        }
        const tagId = parseInt(row.dataset["tagId"]);

        if (e.target.matches('.tag-name')) {
            makeEditable(e.target, 'name', tagId);
        } else if (e.target.matches('.tag-description')) {
            makeEditable(e.target, 'description', tagId);
        }
    });

    deduplBtn.addEventListener('click', async () => {

        if (selected.length < 2) {
            return;
        }
        const tagName = Array.from(container.querySelectorAll('.tag-row')).find(x => parseInt(x.dataset["tagId"]) === selected[0]).querySelector('.tag-name').textContent;
        if (!await confirmDialog(formatMessage("deDuplicate.confirm", { n: selected.length - 1, target: tagName }))) {
            return;
        }

        const formData = new FormData();
        formData.append('tags', JSON.stringify(selected));

        selected.length = 0;

        const updateKept = async (tagId) => {
            const resp = await fetch(`${config.urls.tagInfo}?tag=${tagId}`);

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
            const kept = container.querySelector(`div[data-tag-id="${tagId}"]`);
            kept.querySelector(".tag-name").dataset["used"] = info.used.toFixed(0);
            kept.querySelector(".tag-description").replaceChildren(...info.description.split('\r\n').flatMap(ln => [
                document.createElement('br'),
                document.createTextNode(ln)
            ]).splice(1));
            kept.querySelector(".tagImages").replaceChildren(...info.images.map(fn => {
                const img = document.createElement('div');
                img.style.backgroundImage = `url("${config.urls.loadImage}?fn=${encodeURIComponent(fn)}&tn=true")`;
                return img;
            }));
        };

        const resp = await fetch(config.urls.deDuplicate, { method: 'POST', body: formData });

        if (resp.ok) {
            await alertDialog(formatMessage("deDuplicate.alertOK"));
            
            const details = await resp.json();
            if (details.status !== "success") {
                return;
            }

            updateKept(details.kept);

            for (const tagId of details.removed) {
                const el = container.querySelector(`div[data-tag-id="${tagId}"]`);
                if (el) {
                    el.remove();
                }
            }

            broadcastChannel.postMessage({
                "type": "tagsMerged",
                "details": details
            });
        } else if (resp.headers.get("Content-Type").startsWith("application/json")) {
            const info = await resp.json();
            alertDialog(info.reason);
        } else {
            alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
        }
    });

    deleteBtn.addEventListener('click', async () => {

        if (selected.length < 1) {
            return;
        }
        const tagNames = Array.from(
            container.querySelectorAll('.tag-row')
        ).filter(
            x => selected.indexOf(parseInt(x.dataset["tagId"])) >= 0
        ).map(
            r => `"${r.querySelector('.tag-name').textContent}"`
        );
        if (!await confirmDialog(formatMessage("delete.confirm", { n: tagNames.length, tags: tagNames }))) {
            return;
        }

        const formData = new FormData();
        formData.append('tags', JSON.stringify(selected));

        selected.length = 0;

        const resp = await fetch(config.urls.deleteTags, { method: 'POST', body: formData });

        if (resp.ok) {
            await alertDialog(formatMessage("delete.alertOK", { n: tagNames.length }));
            
            const details = await resp.json();
            if (details.status !== "success") {
                return;
            }

            for (const tagId of details.removed) {
                const el = container.querySelector(`div[data-tag-id="${tagId}"]`);
                if (el) {
                    el.remove();
                }
            }

            broadcastChannel.postMessage({
                "type": "tagsRemoved",
                "details": details
            });
        }  else if (resp.headers.get("Content-Type").startsWith("application/json")) {
            const info = await resp.json();
            alertDialog(info.reason);
        } else {
            alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
        }
    });

    retranBtn.addEventListener('click', async () => {

        if (selected.length < 1) {
            return;
        }
        const tagNames = [];
        const toTranslate = {};

        for (const row of container.querySelectorAll('.tag-row')) {
            const tagId = parseInt(row.dataset["tagId"]);
            if (selected.indexOf(tagId) < 0) {
                continue;
            }
            tagNames.push(`"${row.querySelector('.tag-name').textContent}"`);
            const lang = row.dataset["lang"];
            const origName = row.dataset["origName"];
            const origDesc = row.dataset["origDesc"];
            const tags = toTranslate[lang] || [];
            toTranslate[lang] = tags;
            tags.push({
                "id": tagId,
                "name": origName,
                "description": origDesc,
            });
        }

        if (!await confirmDialog(formatMessage("retran.confirm", { n: tagNames.length, tags: tagNames }))) {
            return;
        }

        for (const sourceLang of Object.keys(toTranslate)) {

            const formData = new FormData();
            formData.append('tags', JSON.stringify(toTranslate[sourceLang]));
            formData.append('sourceLang', sourceLang);
            formData.append('destLang', config.lang);

            selected.length = 0;

            const resp = await fetch(config.urls.translateTags, { method: 'POST', body: formData });

            if (resp.ok) {
                await alertDialog(formatMessage("retran.alertOK", { n: tagNames.length, sourceLang: sourceLang, destLang: config.lang }));
                
                const details = await resp.json();
                if (details.status !== "success") {
                    return;
                }

                for (const tag of details.translated) {
                    broadcastChannel.postMessage({
                        "type": "tagUpdated",
                        "details": {
                            "tagId": tag.id,
                            "field": "name",
                            "newValue": tag.name
                        }
                    });
                    requestAnimationFrame(() => broadcastChannel.postMessage({
                        "type": "tagUpdated",
                        "details": {
                            "tagId": tag.id,
                            "field": "description",
                            "newValue": tag.description
                        }
                    }));
                }
            }  else if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(formatMessage("GENERIC_COMMUNICATION_ERROR"))
            }
        }

    });

    fetchTags();

    function formatMessage(templateKey, values) {
        let template = config.resources[templateKey] || templateKey;

        const formatValue = (v) => {
            if (Array.isArray(v)) {
                return config.listFormatter.format(v); 
            } else {
                return v;
            }
        };

        // --- Pluralization Logic ---
        if (typeof template === 'object' && template !== null && 'n' in values) {
            
            const count = values['n'];
            
            const pluralCategory = config.pluralRules.select(count); 

            // 2. Select the correct template based on the plural category
            if (template.hasOwnProperty(pluralCategory)) {
                template = template[pluralCategory];
            } else if (resourceValue.hasOwnProperty('other')) {
                template = template['other'];
            } else {
                // If the resource object is malformed, use the key as a fallback
                template = templateKey;
            }
        }

        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return key in values ? formatValue(values[key]) : match;
        });
    }

    function confirmDialog(message) {

        const confirmBox = document.getElementById('confirmBox');
        const okBtn = document.getElementById('okBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        document.getElementById('confirmMessage').textContent = message;

        confirmBox.showPopover();

        return new Promise(resolve => {

            const ok = () => (resolve(true), confirmBox.hidePopover(), cancelBtn.removeEventListener("click", cancel));
            const cancel = () => (resolve(false), confirmBox.hidePopover(), okBtn.removeEventListener("click", ok));
            okBtn.addEventListener("click", ok, { once: true });
            cancelBtn.addEventListener("click", cancel, { once: true });
        });
    }

    function alertDialog(message) {

        const alertBox = document.getElementById('alertBox');
        const ackBtn = document.getElementById('ackBtn');

        document.getElementById('alertMessage').textContent = message;

        alertBox.showPopover();

        return new Promise(resolve => {

            ackBtn.addEventListener('click', () => (resolve(true), alertBox.hidePopover()), { once: true });
        });
    }

    async function fetchTags() {

        const resp = await fetch(`${config.urls.tags}?extended=true`);

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

        const fragment = await tags.map(buildTagRow).reduce(async (fragmentPromise, rowPromise) => {

            const frag = await fragmentPromise;

            frag.appendChild(await rowPromise);

            return frag;
        }, Promise.resolve(document.createDocumentFragment()));

        container.replaceChildren(fragment);
    }
};