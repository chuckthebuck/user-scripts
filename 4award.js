/*
 *
 *
 * Notes:
 * - This is intentionally conservative in a few places where wikitext varies.
 * - The article creation date is auto-detected from the oldest non-redirect revision when possible,
 *   but the user must still verify it.
 * - Article history parsing is template-based and may need adjustment if local formatting varies.
 *
 
 */

function normalizeUser(u) {
    return (u || '')
        .replace(/_/g, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
(function () {
    'use strict';

    if (mw.config.get('wgPageName') !== 'Wikipedia:Four_Award') {
        return;
    }

    var NOM_SECTION_HEADING = 'Current nominations';
    var RECORDS_PAGE = 'Wikipedia:Four Award/Records';
    var MAIN_PAGE = 'Wikipedia:Four Award';
    var API = new mw.Api();

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeTitle(title) {
        return mw.Title.newFromText(title) ? mw.Title.newFromText(title).getPrefixedText() : title;
    }

    function talkPageTitleForArticle(articleTitle) {
        var title = mw.Title.newFromText(articleTitle);
        if (!title) {
            throw new Error('Invalid article title: ' + articleTitle);
        }
        return title.getTalkPage().getPrefixedText();
    }
    function makeInput(label, id, value) {
    return `
        <label class="cdx-label">${label}</label>
        <div class="cdx-text-input">
            <input id="${id}" class="cdx-text-input__input" value="${value || ''}">
        </div>
    `;
    	
    }
    function userTalkTitle(username) {
        return 'User talk:' + username.replace(/^User:/i, '').trim();
    }

    function currentDateYMD() {
        var d = new Date();
        var y = d.getUTCFullYear();
        var m = String(d.getUTCMonth() + 1).padStart(2, '0');
        var day = String(d.getUTCDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

function dateFromMwTimestamp(ts) {
    if (!ts) {
        return '';
    }

    // ISO timestamp like 2024-05-07T12:34:56Z
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
        return ts.slice(0, 10);
    }

    // MW compact timestamp like 20240507123456
    if (/^\d{8,}$/.test(ts)) {
        return ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8);
    }

    return '';
}
    function linkNode(href, text) {
        return $('<a>').attr('href', href).attr('target', '_blank').text(text);
    }

    async function getPageWikitext(title) {
        var data = await API.get({
            action: 'query',
            prop: 'revisions',
            rvslots: 'main',
            rvprop: 'content',
            titles: title,
            formatversion: 2
        });
        var page = data.query && data.query.pages && data.query.pages[0];
        if (!page || page.missing) {
            throw new Error('Page not found: ' + title);
        }
        return page.revisions && page.revisions[0] && page.revisions[0].slots.main.content || '';
    }

    async function editPage(title, text, summary, basetimestamp) {
        return API.postWithEditToken({
            action: 'edit',
            title: title,
            text: text,
            summary: summary,
            basetimestamp: basetimestamp,
            format: 'json'
        });
    }

    async function appendSection(title, sectionTitle, sectionText, summary) {
        return API.postWithEditToken({
            action: 'edit',
            title: title,
            section: 'new',
            sectiontitle: sectionTitle,
            text: sectionText,
            summary: summary,
            format: 'json'
        });
    }

    async function getPageRevisionMeta(title) {
        var data = await API.get({
            action: 'query',
            prop: 'revisions',
            rvprop: 'timestamp|content',
            rvslots: 'main',
            titles: title,
            formatversion: 2
        });
        var page = data.query.pages[0];
        if (!page || page.missing) {
            throw new Error('Page not found: ' + title);
        }
        var rev = page.revisions && page.revisions[0];
        return {
            basetimestamp: rev && rev.timestamp,
            content: rev && rev.slots && rev.slots.main && rev.slots.main.content || ''
        };
    }

    async function getNominationSectionText() {
        var meta = await getPageRevisionMeta(MAIN_PAGE);
        return meta;
    }

function CTBextractNominationsFromSection(wikitext) {
    const lines = wikitext.split(/\r?\n/);

    let inSection = false;
    let buffer = [];
    const nominations = [];

    function flush() {
        const text = buffer.join('\n').trim();
        if (text) {
            nominations.push(text);
        }
        buffer = [];
    }

    for (const line of lines) {
        // Start at the level-2 "Current nominations" heading
        if (!inSection) {
            if (/^==\s*Current nominations\s*==\s*$/i.test(line)) {
                inSection = true;
            }
            continue;
        }

        // New nomination starts at a level-4 heading
        if (/^====/.test(line)) {
            flush();
            buffer = [line];
            continue;
        }

        // End only at the NEXT level-2 heading, not h3/h4
        if (/^==\s*[^=].*==\s*$/.test(line)) {
            break;
        }

        // Ignore text before first nomination
        if (!buffer.length) {
            continue;
        }

        buffer.push(line);
    }

    flush();
    return nominations;
}
function ctbParseNominationText(text) {
    text = text || '';

    const nominatorMatch =
        text.match(/\{\{\s*user\s*\|\s*(?:1=)?\s*([^|}\n]+)\s*/i) ||
        text.match(/\[\[\s*User:([^|\]]+)/i);

    const articleMatch = text.match(/^\s*Article:\s*'''?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/im);

    return {
        nominator: nominatorMatch ? nominatorMatch[1].trim() : '',
        article: articleMatch ? normalizeTitle(articleMatch[1].trim()) : '',
        rawText: text
    };
}
    async function getOldestNonRedirectRevision(articleTitle) {
        var title = normalizeTitle(articleTitle);
        var data = await API.get({
            action: 'query',
            prop: 'revisions',
            titles: title,
            rvlimit: 'max',
            rvdir: 'newer',
            rvprop: 'ids|timestamp|content',
            rvslots: 'main',
            formatversion: 2
        });

        var page = data.query.pages[0];
        if (!page || page.missing || !page.revisions) {
            return null;
        }

        for (var i = 0; i < page.revisions.length; i++) {
            var rev = page.revisions[i];
            var content = rev.slots && rev.slots.main && rev.slots.main.content || '';
            if (!/^\s*#redirect\b/i.test(content)) {
                return {
                    revid: rev.revid,
                    parentid: rev.parentid,
                    timestamp: rev.timestamp,
                    url: mw.util.getUrl(title, { oldid: rev.revid })
                };
            }
        }

        return null;
    }

    function parseArticleHistoryField(text, key) {
        var regex = new RegExp('\\|\\s*' + escapeRegExp(key) + '\\s*=\\s*([^|}\n]+)', 'i');
        var match = text.match(regex);
        return match ? match[1].trim() : '';
    }

    async function getArticleHistoryData(articleTitle) {
        var talkTitle = talkPageTitleForArticle(articleTitle);
        var text = await getPageWikitext(talkTitle);
        var hasTemplate = /\{\{\s*Article history\b/i.test(text);
        if (!hasTemplate) {
            throw new Error('No {{Article history}} template found on ' + talkTitle);
        }

        var dykDate = parseArticleHistoryField(text, 'dykdate') || parseArticleHistoryField(text, 'dyk date');
        var gaDate = parseArticleHistoryField(text, 'gac') || parseArticleHistoryField(text, 'gadate') || parseArticleHistoryField(text, 'ga date');
        var faDate = parseArticleHistoryField(text, 'fac') || parseArticleHistoryField(text, 'fadate') || parseArticleHistoryField(text, 'fa date');
        var four = parseArticleHistoryField(text, 'four');

        return {
            talkTitle: talkTitle,
            text: text,
            hasTemplate: true,
            dykDate: dykDate,
            gaDate: gaDate,
            faDate: faDate,
            four: four
        };
    }

    async function getExistingRecordCount(username) {
    var text = await getPageWikitext(RECORDS_PAGE);
    var regex = new RegExp("\\[\\[User:" + escapeRegExp(username) + "(?:\\||\\]\\])", 'gi');
    var matches = text.match(regex);
    return matches ? matches.length : 0;
}
    

    function ctbBuildRecordRow(data) {
    	var userLabel = '[[' + 'User:' + data.nominator + '|' + data.nominator + ']]' + (data.previous4As > 0 ? ' (' + (data.previous4As + 1) + ')' : '');
    	var articleDisplay = '[[' + data.article + ']]';
        return '|-\n' +
		 '| ' + userLabel + '\n' +
		 '| ' + articleDisplay + '\n' +
		 '| ' + data.awardDate + '\n' +
		 '| ' + data.creationDate + '\n' +
		 '| ' + data.dykDate + '\n' +
		 '| ' + data.gaDate + '\n' +
		 '| ' + data.faDate + '\n';
    }

    function appendToTable(text, rowText) {
        var index = text.lastIndexOf('|}');
        if (index === -1) {
            throw new Error('Could not find end of records table.');
        }
        return text.slice(0, index) + rowText + text.slice(index);
    }

    function incrementAuthorCount(text, newCount) {
        var regex = /(written by\s+'''?)(\d+)('''?\s+authors?)/i;
        if (!regex.test(text)) {
            throw new Error('Could not find author count on main page.');
        }
        return text.replace(regex, '$1' + String(newCount) + '$3');
    }

    function addFourYesToArticleHistory(text) {
        if (/\|\s*four\s*=\s*yes/i.test(text)) {
            return text;
        }
        return text.replace(/(\{\{\s*Article history\b[^]*?)(\n\}\})/i, function (_, before, end) {
            return before + '\n|four=yes' + end;
        });
    }

    function removeNominationFromPage(fullText, nominationText) {
        var trimmedNom = nominationText.trim();
        if (fullText.indexOf(trimmedNom) !== -1) {
            return fullText.replace(trimmedNom, '').replace(/\n{3,}/g, '\n\n');
        }

        var escaped = escapeRegExp(trimmedNom).replace(/\n/g, '\\s*\\n');
        var regex = new RegExp(escaped, 'm');
        if (regex.test(fullText)) {
            return fullText.replace(regex, '').replace(/\n{3,}/g, '\n\n');
        }

        throw new Error('Could not remove nomination from main page; nomination text did not match exactly.');
    }

    function makeField(label, $input, helpNode) {
        var $wrapper = $('<div>').css({ marginBottom: '10px' });
        $wrapper.append($('<label>').css({ display: 'block', fontWeight: 'bold', marginBottom: '4px' }).text(label));
        $wrapper.append($input);
        if (helpNode) {
            $wrapper.append($('<div>').css({ marginTop: '4px', fontSize: '0.9em' }).append(helpNode));
        }
        return $wrapper;
    }

    function makeTextInput(value) {
        return $('<input>').attr('type', 'text').val(value || '').css({ width: '100%', boxSizing: 'border-box' });
    }

    function makeTextarea(value) {
        return $('<textarea>').val(value || '').attr({ rows: 4 }).css({ width: '100%', boxSizing: 'border-box' });
    }

    function showMessage($container, text, type) {
        var bg = type === 'error' ? '#fee' : type === 'success' ? '#efe' : '#eef';
        $container.empty().append(
            $('<div>').css({ padding: '8px', background: bg, border: '1px solid #aaa' }).text(text)
        );
    }

    async function processApproved(data, ui, nomination) {
        var statusBox = ui.statusBox;
        showMessage(statusBox, 'Processing approved nomination…', 'info');

        var talkSectionTitle = 'Four Award for ' + data.article;
        var talkText = '{{' + 'subst:Four Award Message|' + data.article + '}}';

        if (data.customMessage.trim()) {
            talkText += '\n\n' + data.customMessage.trim();
        }

        await appendSection(
            userTalkTitle(data.nominator),
            talkSectionTitle,
            talkText,
            'Notifying user about Four Award for [[' + data.article + ']]'
        );

        var recordsMeta = await getPageRevisionMeta(RECORDS_PAGE);
        var newRow = ctbBuildRecordRow(data);
        var updatedRecords = appendToTable(recordsMeta.content, newRow);
        await editPage(
            RECORDS_PAGE,
            updatedRecords,
            'Recording Four Award for [[' + data.article + ']]',
            recordsMeta.basetimestamp
        );

        if (data.previous4As === 0) {
            var mainMeta = await getPageRevisionMeta(MAIN_PAGE);
            var currentCountMatch = mainMeta.content.match(/written by\s+'''?(\d+)'''?\s+authors?/i);
            if (!currentCountMatch) {
                throw new Error('Could not determine current author count on main page.');
            }
            var newCount = Number(currentCountMatch[1]) + 1;
            var updatedMainCount = incrementAuthorCount(mainMeta.content, newCount);
            await editPage(
                MAIN_PAGE,
                updatedMainCount,
                'Updating Four Award author count after award for [[' + data.article + ']]',
                mainMeta.basetimestamp
            );
        }

        var talkMeta = await getPageRevisionMeta(data.articleTalkPage);
        var updatedTalk = addFourYesToArticleHistory(talkMeta.content);
        await editPage(
            data.articleTalkPage,
            updatedTalk,
            'Adding |four=yes to {{Article history}} for [[' + data.article + ']]',
            talkMeta.basetimestamp
        );

        var mainMeta2 = await getPageRevisionMeta(MAIN_PAGE);
        var updatedMain = removeNominationFromPage(mainMeta2.content, nomination.rawText);
        await editPage(
            MAIN_PAGE,
            updatedMain,
            'Removing completed Four Award nomination for [[' + data.article + ']]',
            mainMeta2.basetimestamp
        );

        showMessage(statusBox, 'Done. Approved workflow completed successfully.', 'success');
    }

    async function processDeclined(data, ui, nomination) {
        var statusBox = ui.statusBox;
        showMessage(statusBox, 'Processing declined nomination…', 'info');

        var sectionTitle = 'Four Award for ' + data.article;
        var text = 'This Four Award nomination for [[' + data.article + ']] was declined.\n\nReason given:\n' + data.declineReason.trim();

        await appendSection(
            userTalkTitle(data.nominator),
            sectionTitle,
            text,
            'Notifying user about declined Four Award nomination for [[' + data.article + ']]'
        );

        var mainMeta = await getPageRevisionMeta(MAIN_PAGE);
        var updatedMain = removeNominationFromPage(mainMeta.content, nomination.rawText);
        await editPage(
            MAIN_PAGE,
            updatedMain,
            'Removing declined Four Award nomination for [[' + data.article + ']]',
            mainMeta.basetimestamp
        );

        showMessage(statusBox, 'Done. Declined workflow completed successfully.', 'success');
    }
async function openDialogForNomination(nominationText, $header) {
    var parsed = ctbParseNominationText(nominationText);

    if (!parsed.nominator || !parsed.article) {
        mw.notify('Could not parse nomination header and/or article line.', { type: 'error' });
        return;
    }

    // --- Extract DOM links ---
    var $contentBlock = $header.closest('.mw-heading4').nextUntil('.mw-heading4');

    var links = {
        dyk: null,
        ga: null,
        fa: null,
        creation: null
    };

    $contentBlock.find('a').each(function () {
        var href = $(this).attr('href') || '';

        if (/Did_you_know_archive/i.test(href)) {
            links.dyk = href;
        } else if (/\/GA\d+/i.test(href)) {
            links.ga = href;
        } else if (/Featured_article_candidates/i.test(href)) {
            links.fa = href;
        } else if (/diff=/i.test(href)) {
            links.creation = href;
        }
    });

    // --- Parse DYK date from URL ---
function parseDykDate(url) {
    if (!url) return '';

    var match = url.match(/Did_you_know_archive\/(\d{4})\/([A-Za-z]+)#(\d{1,2})_[A-Za-z]+_\d{4}/i);
    if (!match) return '';

    var year = match[1];
    var monthName = match[2];
    var day = match[3];

    var date = new Date(monthName + ' ' + day + ', ' + year);
    return isNaN(date) ? '' : date.toISOString().slice(0, 10);
}
    // --- Fetch history data (GA/FA/DYK fallback) ---
    var history = await getArticleHistoryData(parsed.article).catch(() => null);

    // --- Fetch creation date ---
    async function getCreationDateSafe(article) {
        try {
            var rev = await getOldestNonRedirectRevision(article);
            return rev ? dateFromMwTimestamp(rev.timestamp) : '';
        } catch {
            return '';
        }
    }

    var dykDate = links.dyk
        ? parseDykDate(links.dyk)
        : (history?.dykDate || '');

    var gaDate = history?.gaDate || '';
    var faDate = history?.faDate || '';
    var creationDate = await getCreationDateSafe(parsed.article);

    mw.loader.load('codex-styles');

    var dialog = document.createElement('dialog');
    dialog.className = 'cdx-dialog-backdrop';

    dialog.innerHTML = `
        <div class="cdx-dialog">
            <header class="cdx-dialog__header">
                <h2 class="cdx-dialog__title">Four Award helper — ${parsed.article}</h2>
            </header>
            <div class="cdx-dialog__body">
                <div class="cdx-message cdx-message--warning">
                    Reminder: this script does not verify eligibility. You must confirm criteria manually.
                </div>

                <label class="cdx-label">Result</label>
                <select id="mode" class="cdx-select">
                    <option value="approved">Approved</option>
                    <option value="declined">Declined</option>
                </select>

                ${makeInput('Nominator', 'nominator', parsed.nominator)}
                ${makeInput('Article', 'article', parsed.article)}
                ${makeInput('Award date', 'awardDate', currentDateYMD())}
                ${makeInput('Creation date', 'creationDate', creationDate)}
                ${makeInput('DYK date', 'dykDate', dykDate)}
                ${makeInput('GA date', 'gaDate', gaDate)}
                ${makeInput('FA date', 'faDate', faDate)}
                ${makeInput('Previous 4As', 'previous4As', '0')}

                <label class="cdx-label">Custom message</label>
                <textarea id="customMessage" class="cdx-text-input__input"></textarea>

                <label class="cdx-label">Decline reason</label>
                <textarea id="declineReason" class="cdx-text-input__input"></textarea>

                <div id="status"></div>
            </div>

            <footer class="cdx-dialog__footer">
                <button id="cancelBtn" class="cdx-button">Cancel</button>
                <button id="runBtn" class="cdx-button cdx-button--action-progressive">Run</button>
            </footer>
        </div>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    function val(id) {
        return dialog.querySelector('#' + id).value.trim();
    }

    dialog.querySelector('#cancelBtn').onclick = () => dialog.remove();

    dialog.querySelector('#runBtn').onclick = async () => {
        try {
            var payload = {
                nominator: val('nominator'),
                article: val('article'),
                awardDate: val('awardDate'),
                creationDate: val('creationDate'),
                dykDate: val('dykDate'),
                gaDate: val('gaDate'),
                faDate: val('faDate'),
                previous4As: Number(val('previous4As') || 0),
                customMessage: val('customMessage'),
                declineReason: val('declineReason'),
                articleTalkPage: talkPageTitleForArticle(val('article'))
            };

            if (!payload.nominator || !payload.article) {
                throw new Error('Nominator and article required.');
            }

            if (dialog.querySelector('#mode').value === 'approved') {
                await processApproved(payload, { statusBox: $('#status') }, { rawText: nominationText });
            } else {
                await processDeclined(payload, { statusBox: $('#status') }, { rawText: nominationText });
            }

            dialog.remove();
        } catch (err) {
            mw.notify(err.message, { type: 'error' });
        }
    };
}
    async function addLinksToRenderedNominations() {
    var $content = $('#mw-content-text');

    var fullText = await getPageWikitext(MAIN_PAGE);
    var noms = CTBextractNominationsFromSection(fullText);

	var $headers = $content.find('.mw-heading4 > h4');   
	mw.notify('Headers found: ' + $headers.length, { type: 'info', autoHide: true });

    if (!$headers.length) {
    return;
    	
    }

    $headers.each(function () {
    var $header = $(this);
var username = decodeURIComponent($header.attr('id') || '')
        .split('_(')[0]
        .replace(/_/g, ' ')
        .trim();
    var usernameNorm = normalizeUser(username);

	var nomination = noms.find(n => {
	  var parsed = ctbParseNominationText(n);
    	return normalizeUser(parsed.nominator) === usernameNorm;
});
console.log({
    dom: username,
    parsed: noms.map(n => ctbParseNominationText(n))

});

    if ($header.find('.four-award-helper-link').length) {
        return;
    }

    var $helper = $('<a>')
        .attr('href', '#')
        .addClass('four-award-helper-link')
        .css({ marginLeft: '0.5em', fontSize: '0.9em' })
        .text('[4A helper]');

    $helper.on('click', function (e) {
        e.preventDefault();

        if (!nomination) {
            mw.notify('Could not match this nomination.', { type: 'error' });
            return;
        }

        openDialogForNomination(nomination, $header);
    });

    $header.append(
        $('<span>').css({ marginLeft: '0.5em' }).append($helper)
    );
});
}

    function init() {
    mw.loader.using([
        'mediawiki.api',
        'mediawiki.util'
    ]).then(async function () {
        await addLinksToRenderedNominations();
        mw.notify('Four Award helper loaded.', { type: 'info', autoHide: true });
        
    });
}

    $(init);
}());
