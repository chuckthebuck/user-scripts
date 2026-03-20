/// CTB Mass Rollback + Chuckbot + Multi-page + Attribution
/// Mass rollback function with user-specified rate limit and bot tagging (if flagged)
/// Re-written by Alachuckthebuck based on original(s) by:  MolecularPilot, Mr.Z-man, John254, Writ Keeper and TheDJ 
///forked and modifed  by Alachuckthebuck to use chuckbot. 
if (typeof CTBContribsCheckboxInit === "undefined") {
    CTBContribsCheckboxInit = false;
}

if (typeof CTBRollbackPortlet === "undefined") {
    CTBRollbackPortlet = "p-cactions";
}

const CHUCKBOT_THRESHOLD = 100;
const CHUCKBOT_BATCH_SIZE = 1000;
const MULTIPAGE_MAX_EDITS = 10000;

// 🔐 Admin check
function isMultiPageAllowed() {
    const groups = mw.config.get("wgUserGroups") || [];
    const user = mw.config.get("wgUserName") || "";
    return groups.includes("sysop") || user === "Alachuckthebuck";
}

function getPortletTarget() {
    const candidates = [
        CTBRollbackPortlet,
        "p-associated-pages",
        "p-tb",
        "p-personal",
        "p-navigation"
    ];
    for (const id of candidates) {
        if (document.getElementById(id)) return id;
    }
    return null;
}

// =====================
// 🔥 Build summary with attribution
// =====================
function buildSummary(editSummary) {
    const requester = mw.config.get("wgUserName") || "Unknown";
    const attribution = `Rollback requested by [[Special:Contributions/${requester}|${requester}]]`;

    return editSummary
        ? `${editSummary} — ${attribution}`
        : attribution;
}

// =====================
// 🔥 Chuckbot sender
// =====================
async function sendCollectedItemsToChuckbot(items, editSummary) {
    if (!items.length) {
        mw.notify("No items to send.");
        return false;
    }

    const batchId = Date.now();
    const statusToken = prompt("Optional: Status token (leave blank if logged in)");
    const finalSummary = buildSummary(editSummary);

    mw.notify(`Sending ${items.length} edits to Chuckbot...`);

    try {
        for (let i = 0; i < items.length; i += CHUCKBOT_BATCH_SIZE) {
            const chunk = items.slice(i, i + CHUCKBOT_BATCH_SIZE);

            const res = await fetch("https://buckbot.toolforge.org/api/v1/rollback/jobs", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(statusToken ? { "X-Status-Token": statusToken } : {})
                },
                body: JSON.stringify({
                    requested_by: mw.config.get("wgUserName") || "CTBMR",
                    items: chunk.map(item => ({
                        ...item,
                        summary: finalSummary
                    })),
                    batch_id: batchId
                })
            });

            if (!res.ok) {
                throw new Error(await res.text());
            }
        }

        mw.notify(
            `✅ Chuckbot job queued (${items.length} edits). 
             <a href="https://buckbot.toolforge.org/rollback-queue/all-jobs?batch_id=${batchId}" target="_blank">
                View this batch →
             </a>`,
            { autoHide: false }
        );

        return true;
    } catch (err) {
        console.error(err);
        mw.notify("❌ Failed to send to Chuckbot");
        return false;
    }
}

async function sendToChuckbotFromLinks(links, editSummary) {
    const items = [];

    links.each(function (_, el) {
        const match = /title=([^&]+)/.exec(el.href);
        if (!match) return;

        const title = decodeURIComponent(match[1]);
        const $li = $(el).closest("li");

        let user = mw.config.get("wgRelevantUserName");
        if (!user) {
            user = $li.find("a.mw-anonuserlink").first().text();
        }

        if (title && user) items.push({ title, user });
    });

    return await sendCollectedItemsToChuckbot(items, editSummary);
}

// =====================
// 🔁 Rollback functions
// =====================
function rollbackEverythingCTBMR(editSummary) {
    if (editSummary === null) return false;

    const links = $("a[href*='action=rollback']");

    if (links.length > CHUCKBOT_THRESHOLD) {
        (async () => {
            if (!confirm(`Rollback ${links.length} edits via Chuckbot?`)) return;
            const success = await sendToChuckbotFromLinks(links, editSummary);
            if (success) mw.notify("Stopped local execution.");
        })();
        return false;
    }
}

function rollbackSomeThingsCTBMR(editSummary) {
    if (editSummary === null) return false;

    const links = $("input.revdelIds:checked")
        .closest("li")
        .find("a[href*='action=rollback']");

    if (!links.length) {
        mw.notify("No edits selected.");
        return;
    }

    if (links.length > CHUCKBOT_THRESHOLD) {
        (async () => {
            if (!confirm(`Rollback ${links.length} edits via Chuckbot?`)) return;
            const success = await sendToChuckbotFromLinks(links, editSummary);
            if (success) mw.notify("Stopped local execution.");
        })();
        return false;
    }
}

// =====================
// 📄 Multi-page collector
// =====================
(function multiPageCollector() {
    let remaining = parseInt(sessionStorage.getItem("ctbMultiPageRemaining") || "0");
    if (remaining <= 0) return;

    let stored = JSON.parse(sessionStorage.getItem("ctbMultiPageItems") || "[]");

    $("a[href*='action=rollback']").each(function (_, el) {
        const title = decodeURIComponent(/title=([^&]+)/.exec(el.href)[1]);
        const $li = $(el).closest("li");

        let user = mw.config.get("wgRelevantUserName");
        if (!user) {
            user = $li.find("a.mw-anonuserlink").first().text();
        }

        stored.push({ title, user });
    });

    sessionStorage.setItem("ctbMultiPageItems", JSON.stringify(stored));

    remaining--;
    sessionStorage.setItem("ctbMultiPageRemaining", remaining);

    if (remaining > 0) {
        const next = document.querySelector("a.mw-nextlink");
        if (next) {
            setTimeout(() => window.location.href = next.href, 1000);
        }
    } else {
        const items = JSON.parse(sessionStorage.getItem("ctbMultiPageItems") || "[]");
        sessionStorage.clear();

        if (!confirm(`Send ${items.length} edits to Chuckbot?`)) return;
        sendCollectedItemsToChuckbot(items);
    }
})();

// =====================
// 🎛 UI setup
// =====================
mw.loader.using(["mediawiki.util", "jquery"]).then(() => {
    mw.hook("wikipage.content").add(function () {
        if (mw.config.get("wgCanonicalSpecialPageName") !== "Contributions") return;

        const portlet = getPortletTarget();
        if (!portlet) return;

        mw.util.addPortletLink(portlet, "#", "Rollback all", "ca-rollbackeverything");
        mw.util.addPortletLink(portlet, "#", "Rollback selected", "ca-rollbacksome");
        mw.util.addPortletLink(portlet, "#", "Load 5000 edits", "ca-load5000");

        $("#ca-rollbackeverything").click(e => {
            e.preventDefault();
            rollbackEverythingCTBMR(prompt("Edit summary:"));
        });

        $("#ca-rollbacksome").click(e => {
            e.preventDefault();
            rollbackSomeThingsCTBMR(prompt("Edit summary:"));
        });

        $("#ca-load5000").click(e => {
            e.preventDefault();
            const url = new URL(window.location.href);
            url.searchParams.set("limit", "5000");
            url.searchParams.set("topOnly", "1");

            window.location.href = url.toString();
        });

        // Multi-page (restricted)
        if (isMultiPageAllowed()) {
            mw.util.addPortletLink(portlet, "#", "Multi-page rollback", "ca-multipage");

            $("#ca-multipage").click(e => {
                e.preventDefault();

                let pages = parseInt(prompt("Pages?", "3"));
                let perPage = parseInt(prompt("Per page (1–5000)?", "5000"));

                if (!pages || !perPage) return;

                if (pages * perPage > MULTIPAGE_MAX_EDITS) {
                    mw.notify("Too many edits.");
                    return;
                }

                sessionStorage.setItem("ctbMultiPageRemaining", pages);
                sessionStorage.setItem("ctbMultiPageItems", JSON.stringify([]));

                const url = new URL(window.location.href);
                url.searchParams.set("limit", perPage);
                url.searchParams.set("topOnly", "1");

                window.location.href = url.toString();
            });
        }
    });
});
