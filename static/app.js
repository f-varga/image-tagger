window.onload = () => {

    initImageViewer();
    initPager();
    initAddTag();
    initSearch();
    initFilterTags();
};

const images = [];
const tags = [];
const tagFilter = {
    "name": null
};

function alertDialog(message) {

    const alertBox = document.getElementById('alertBox');
    const ackBtn = document.getElementById('ackBtn');

    document.getElementById('alertMessage').textContent = message;

    alertBox.showPopover();

    return new Promise(resolve => {

        ackBtn.addEventListener('click', () => (resolve(true), alertBox.hidePopover()), { once: true });
    });
}

function initAddTag() {

    const form = document.getElementById("addTag");
    const nameInput = document.getElementById("tagName");
    const descriptionInput = document.getElementById("tagDescription");

    form.addEventListener("submit", async (e) => {

        e.preventDefault();

        const name = nameInput.value.trim();
        if (!name) {

            return;
        }

        const description = descriptionInput.value.trim();

        let formData = new FormData();
        formData.append('name', name);
        formData.append('description', description);

        const resp = await fetch(config.urls.addTag, { method: 'POST', body: formData });

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(GENERIC_COMMUNICATION_ERROR)
            }
            return;
        }

        const tag = await resp.json();

        nameInput.value = '';
        descriptionInput.value = '';

        const index = parseInt(document.getElementById("pagerCrt").textContent) - 1;
        const fn = images[index];
        const tagId = tag.id;

        toggleAddedTag(formData, fn, tagId);
    });

    async function toggleAddedTag(formData, fn, tagId) {
        formData = new FormData();
        formData.append("fn", fn);
        formData.append("tags", JSON.stringify([tagId]));

        const resp = await fetch(config.urls.toggleTags, { method: 'POST', body: formData });

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(GENERIC_COMMUNICATION_ERROR)
            }
            return;
        }

        loadTags();
    }
}

async function initTags() {

    await loadTags();

    let top = null, tor = null;
    let pending = {};

    const container = document.getElementById("tagsContainer");

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
                Array.from(container.children).map(el => [el.dataset["tagId"], el])
            );
            const maxUsed = Math.max(...tags.map(t => t.used));
            tags.forEach(tag => {
                const el = elementMap.get(tag.id);
                const hue = 240 - (240 * (t.used / maxUsed));
                el.style.setProperty("--tag-color", `hsl(${hue}, 80%, 92%)`);
                if (el) {
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
                        alertDialog(GENERIC_COMMUNICATION_ERROR)
                    }
                }
            }
        }, 5e3);
    });

    let hoverId = null, tof = null;
    container.addEventListener("mouseover", async (e) => {
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
        const resp = await fetch(config.urls.tagInfo.concat("?tag=", encodeURIComponent(hoverId)));

        if (!resp.ok) {
            if (resp.headers.get("Content-Type").startsWith("application/json")) {
                const info = await resp.json();
                alertDialog(info.reason);
            } else {
                alertDialog(GENERIC_COMMUNICATION_ERROR)
            }
            return;
        }

        const info = await resp.json();
        let flyout = document.getElementById('flyout');

        tof = setTimeout(async () => {
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
        }, 100);
    });
}

async function loadTags() {

    const resp = await fetch(config.urls.tags);

    if (!resp.ok) {
        if (resp.headers.get("Content-Type").startsWith("application/json")) {
            const info = await resp.json();
            alertDialog(info.reason);
        } else {
            alertDialog(GENERIC_COMMUNICATION_ERROR)
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
        const hue = 240 - (240 * (t.used / maxUsed));
        const div = document.createElement('div');
        div.classList.add('tag-wrapper');
        div.style.setProperty("--tag-color", `hsl(${hue}, 80%, 92%)`);
        div.dataset["tagId"] = t.id.toFixed(0);
        if (tagFilter.name) {
            div.style.display = t.name.search(tagFilter.name) < 0 ? 'none' : '';
        }
        const label = document.createElement('label');
        label.setAttribute("for", `tag_${t.id}`);
        const info = document.createElement('i');
        info.classList.add('info-icon');
        info.classList.add('fa-solid');
        info.classList.add('fa-circle-info');
        label.appendChild(info);
        label.appendChild(document.createTextNode(t.name));
        div.appendChild(label);
        const input = document.createElement('input');
        input.setAttribute("type", "checkbox");
        input.setAttribute("id", `tag_${t.id}`);
        input.setAttribute("name", `tag_${t.id}`);
        div.appendChild(input);
        fragment.appendChild(div);
    }

    container.replaceChildren(fragment);

    loadImageTags();
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
            alertDialog(GENERIC_COMMUNICATION_ERROR);
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

async function initImageViewer() {

    const resp = await fetch(config.urls.images);

    if (!resp.ok) {
        if (resp.headers.get("Content-Type").startsWith("application/json")) {
            const info = await resp.json();
            alertDialog(info.reason);
        } else {
            alertDialog(GENERIC_COMMUNICATION_ERROR)
        }
        return;
    }

    images.length = 0;
    images.push(...await resp.json());

    document.getElementById('pagerCrt').textContent = '1';
    document.getElementById('pagerAll').textContent = images.length.toFixed(0);
    document.getElementById('pagerPrevious').disabled = true;
    document.getElementById('pagerNext').disabled = images.length < 2;

    document.getElementById('imageContainer').style.backgroundImage = 'url("'.concat(config.urls.loadImage, '?fn=', encodeURIComponent(images[0]), '")');

    initTags();
}

async function initPager() {

    const next = document.getElementById('pagerNext'),
        previous = document.getElementById('pagerPrevious'),
        crt = document.getElementById('pagerCrt'),
        imageContainer = document.getElementById('imageContainer'),
        jump = document.getElementById('pagerJump');

    const resp = await fetch(config.urls.latest);

    if (!resp.ok) {
        if (resp.headers.get("Content-Type").startsWith("application/json")) {
            const info = await resp.json();
            alertDialog(info.reason);
        } else {
            alertDialog(GENERIC_COMMUNICATION_ERROR)
        }
        return;
    }

    const latest = await resp.json();
    if (latest.fn === null) {
        jump.disabled = true;
    } else {
        jump.dataset["latest"] = latest.fn;
        jump.addEventListener('click', () => {
            jump.disabled = true;
            delete jump.dataset["latest"];

            const index = images.indexOf(latest.fn);
            crt.textContent = (index + 1).toFixed(0);
            imageContainer.style.backgroundImage = 'url("'.concat(config.urls.loadImage, '?fn=', encodeURIComponent(images[index]), '")');
            previous.disabled = index <= 0;
            next.disabled = index + 1 >= images.length;

            loadImageTags();
        }, { once: true });
    }

    next.addEventListener('click', async () => {

        const index = parseInt(crt.textContent);

        imageContainer.style.backgroundImage = 'url("'.concat(config.urls.loadImage, '?fn=', encodeURIComponent(images[index]), '")');

        crt.textContent = (index + 1).toFixed(0);

        previous.disabled = index <= 0;
        next.disabled = index + 1 >= images.length;
        jump.disabled = !jump.dataset["latest"] || images[index] === jump.dataset["latest"];

        loadImageTags();
    });

    previous.addEventListener('click', async () => {

        const index = parseInt(crt.textContent) - 2;

        imageContainer.style.backgroundImage = 'url("'.concat(config.urls.loadImage, '?fn=', encodeURIComponent(images[index]), '")');

        crt.textContent = (index + 1).toFixed(0);

        previous.disabled = index <= 0;
        next.disabled = index + 1 >= images.length;
        jump.disabled = !jump.dataset["latest"] || images[index] === jump.dataset["latest"];

        loadImageTags();
    });
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
                    alertDialog(GENERIC_COMMUNICATION_ERROR)
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
                    alertDialog(GENERIC_COMMUNICATION_ERROR)
                }
                return;
            }

            images.length = 0;
            images.push(...await resp.json());
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
        jump.disabled = !jump.dataset["latest"] || images[0] === jump.dataset["latest"];

        loadImageTags();
    }

    searchBar.addEventListener("click", e => {
        if (e.target.tagName === "SPAN" && e.target.parentElement.classList.contains("search-tag")) {
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
        const tr = tagToKeepInView.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        const oldTop = tr.top - cr.top;

        const flt = tags.filter(t => tagFilter.name === null || t.name.search(tagFilter.name) >= 0).map(t => t.id);
        for (const el of container.querySelectorAll('.tag-wrapper')) {
            const tagId = parseInt(el.dataset["tagId"]);
            el.style.display = flt.indexOf(tagId) < 0 ? 'none' : '';
        }

        if (newVal === null) {
            requestAnimationFrame(() => {
                const tr = tagToKeepInView.getBoundingClientRect();
                const cr = container.getBoundingClientRect();
                const newTop = tr.top - cr.top;

                container.scrollBy({ top: newTop - oldTop, behavior: "instant" });
            });
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