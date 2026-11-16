/**
 * The scripts' dialogs and card controls: picking one of several choices, and a card's buttons and notes.
 */

/**
 * Ask the user to pick one of `choices` (HTML for each, escaped by the caller) with radio buttons, below `intro` (HTML)
 * if given, `checked` picked to begin with. `confirm` and `cancel` label the buttons. Resolves to the index picked, or
 * null when cancelled or closed.
 */
async function chooseOne({ title, intro = "", choices, checked = 0, confirm, cancel = "Cancel" }) {
    const content = [
        intro,
        ...choices.map((html, index) =>
            [
                `<label style="display: flex; gap: 0.5em; align-items: center; margin: 0.25em 0">`,
                `<input type="radio" name="choice" value="${index}" ${index === checked ? "checked" : ""}>`,
                `<span>${html}</span>`,
                `</label>`,
            ].join(""),
        ),
    ].join("");
    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title },
        content,
        buttons: [
            {
                action: "ok",
                label: confirm,
                default: true,
                callback: (_event, button) => button.form.elements.choice.value,
            },
            { action: "cancel", label: cancel },
        ],
        rejectClose: false,
    });
    if (typeof choice !== "string" || !/^\d+$/.test(choice)) return null;
    const index = Number(choice);
    return index < choices.length ? index : null;
}

/**
 * A card's button: `icon` (a Font Awesome icon, like "fa-dice-d20") and `label` (HTML). A click runs `onClick(event)`,
 * which returns a promise, with the button disabled until it's settled; its errors go to `log`. With `keepDisabled`,
 * the button stays disabled once `onClick` resolves to true (it did its work, and the card is rendered without it).
 */
function cardButton({ icon, label, onClick, log, keepDisabled = false }) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        onClick(event)
            .catch((error) => void log(error))
            .then((done) => {
                if (!(keepDisabled && done === true)) button.disabled = false;
            });
    });
    return button;
}

/** A card's note of where it stands (HTML), in italics */
function cardNote(html) {
    const note = document.createElement("p");
    note.innerHTML = `<em>${html}</em>`;
    return note;
}

export { cardButton, cardNote, chooseOne };
