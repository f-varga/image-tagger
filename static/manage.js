window.onload = () => {

    const container = document.getElementById('tagsContainer');
    const deleteBtn = document.getElementById('deleteBtn');
    const deduplBtn = document.getElementById('deduplBtn');

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
            } else {
                element.replaceChildren(...newValue.split('\r\n').flatMap(ln => [
                    document.createElement('br'),
                    document.createTextNode(ln)
                ]).splice(1));
            }

            if (newValue !== oldValue) {
                const formData = new FormData();
                formData.append('tag_id', tagId);
                formData.append(field, newValue);

                await fetch(config.urls.updateTag, { method: 'POST', body: formData });
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
    container.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"]')) {
            const tagId = parseInt(e.target.closest('.tag-row').dataset["tagId"]);
            if (e.target.checked && selected.indexOf(tagId) < 0) {
                selected.push(tagId);
            } else if (!e.target.checked) {
                let ix = selected.indexOf(tagId);
                while (ix >= 0) {
                    selected.splice(ix, 1);
                    ix = selected.indexOf(tagId);
                }
            }
        }
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
        if (!await confirmDialog(`Merge ${selected.length} tags into the first one (${tagName})?`)) {
            return;
        }

        const formData = new FormData();
        formData.append('tags', JSON.stringify(selected));

        selected.length = 0;

        const res = await fetch(config.urls.deDuplicate, { method: 'POST', body: formData });

        if (res.ok) {

            await alertDialog('Tags successfully de-duplicated.');

            fetchTags();
        } else {

            await alertDialog('Deduplication failed.');
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
            r => r.querySelector('.tag-name').textContent
        );
        if (!await confirmDialog(`Are you sure you want to deletet the tags (${config.listFormatter.format(tagNames)})?`)) {
            return;
        }

        const formData = new FormData();
        formData.append('tags', JSON.stringify(selected));

        selected.length = 0;

        const res = await fetch(config.urls.deleteTags, { method: 'POST', body: formData });

        if (res.ok) {

            await alertDialog(`${tagNames.length} tags were successfully deleted.`);

            fetchTags();
        } else {

            await alertDialog('Failed to delete tags.');
        }
    });

    fetchTags();
};

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

    const container = document.getElementById('tagsContainer');
    const res = await fetch(config.urls.tags);
    const tags = await res.json();
    tags.sort((a, b) => {
        if (b.used !== a.used) {
            return b.used - a.used;
        }
        return a.name.localeCompare(b.name);
    });

    const loadInfo = async (tagId, descDiv, imgDiv) => {
        const info = await fetch(`${config.urls.tagInfo}?tag=${tagId}`).then(r => r.json());
        descDiv.replaceChildren(...info.description.split('\r\n').flatMap(ln => [
            document.createElement('br'),
            document.createTextNode(ln)
        ]).splice(1));

        for (const fn of info.images) {
            const img = document.createElement('div');
            img.style.backgroundImage = `url("${config.urls.loadImage}?fn=${encodeURIComponent(fn)}&tn=true")`;
            imgDiv.appendChild(img);
        }
    };
    
    const fragment = document.createDocumentFragment();
    for (const tag of tags) {

        const row = document.createElement('div');
        row.className = 'wrapper tag-row';
        row.dataset["tagId"] = tag.id.toFixed(0);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tag-checkbox';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'tag-name';
        nameDiv.textContent = tag.name;
        nameDiv.dataset["used"] = tag.used.toFixed(0);

        const descDiv = document.createElement('div');
        descDiv.className = 'tag-description';

        const imgDiv = document.createElement('div');
        imgDiv.className = 'tag-images';

        loadInfo(tag.id, descDiv, imgDiv);

        row.append(checkbox, nameDiv, descDiv, imgDiv);
        fragment.appendChild(row);
    }

    container.replaceChildren(fragment);
}