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

(function () {
    'use strict';

    if (mw.config.get('wgPageName') !== 'Wikipedia:Four_Award') {
        return;
    }

    var NOM_SECTION_HEADING = 'Nominations';
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
        if (!ts || ts.length < 8) {
            return '';
        }
        return ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8);
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
        var lines = wikitext.split(/\r?\n/);
        var inSection = false;
        var headingRegex = /^==+\s*(.*?)\s*==+\s*$/;
        var buffer = [];
        var nominations = [];
        var currentStart = -1;

        function flush(endLineExclusive) {
            if (!buffer.length) {
                return;
            }
            var text = buffer.join('\n').trim();
            if (text) {
                nominations.push({
                    text: text,
                    startLine: currentStart,
                    endLine: endLineExclusive - 1
                });
            }
            buffer = [];
            currentStart = -1;
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var headingMatch = line.match(headingRegex);
            if (headingMatch) {
                var headingText = headingMatch[1].trim();
                if (inSection) {
                    flush(i);
                    break;
                }
                if (headingText === NOM_SECTION_HEADING) {
                    inSection = true;
                }
                continue;
            }
            if (!inSection) {
                continue;
            }

            if (/^====\s*\{\{\s*user\s*\|/i.test(line)){
                flush(i);
                currentStart = i;
            }
            if (currentStart !== -1) {
                buffer.push(line);
            }
        }

        if (inSection) {
            flush(lines.length);
        }

        return nominations;
    }

    function ctbParseNominationText(text) {
        var nominatorMatch = text.match(/^====\s*\{\{\s*user\s*\|\s*([^}|]+).*?\}\}\s*====/im);
        var articleMatch = text.match(/Article:\s*'''?\[\[([^\]|]+)\]\]/i);

        return {
            nominator: nominatorMatch ? nominatorMatch[1].trim() : '',
            article: articleMatch ? articleMatch[1].trim() : '',
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
        var talkText = '{{subst:Four Award Message|' + data.article + '}}';

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

    async function openDialogForNomination(nomination) {
        var parsed = ctbParseNominationText(nomination.text);
       if (parsed.nominator === username && parsed.article === articleFromDOM) {
       	mw.notify('Could not parse nomination header and/or article line.', { type: 'error' });
       	return;
       	
       }


        var $status = $('<div>');
        var $body = $('<div>');

        var $mode = $('<select>')
            .append($('<option>').val('approved').text('Approved'))
            .append($('<option>').val('declined').text('Declined'));

        var $nominator = makeTextInput(parsed.nominator);
        var $article = makeTextInput(parsed.article);
        var $awardDate = makeTextInput(currentDateYMD());
        var $creationDate = makeTextInput('');
        var $dykDate = makeTextInput('');
        var $gaDate = makeTextInput('');
        var $faDate = makeTextInput('');
        var $previous4As = makeTextInput('0');
        var $customMessage = makeTextarea('');
        var $declineReason = makeTextarea('');
        var $creationHelp = $('<span>').text('Needs manual verification because of possible creation-from-redirect.');
        var $creationDiffHolder = $('<span>');
        var $articleHistoryNotice = $('<div>').css({ marginBottom: '10px', padding: '8px', background: '#f8f9fa', border: '1px solid #ccc' });
        var $requirementsNote = $('<div>').css({ marginBottom: '10px', padding: '8px', background: '#fffbe6', border: '1px solid #ccc' })
            .text('Reminder: the script does not verify whether the editor qualifies for the Four Award. The human user must verify that before proceeding.');

        var ui = {
            statusBox: $status
        };

        var $approvedFields = $('<div>');
        var $declinedFields = $('<div>');

        $approvedFields.append(
            makeField('Award date', $awardDate),
            makeField('Article creation date', $creationDate, $('<span>').append($creationHelp, ' ', $creationDiffHolder)),
            makeField('Date article appeared on DYK', $dykDate),
            makeField('Date of GA promotion', $gaDate),
            makeField('Date of FA promotion', $faDate),
            makeField('Number of previous 4As', $previous4As),
            makeField('Optional custom message', $customMessage)
        );

        $declinedFields.append(
            makeField('Reason for decline', $declineReason)
        ).hide();

        function refreshMode() {
            var isApproved = $mode.val() === 'approved';
            $approvedFields.toggle(isApproved);
            $declinedFields.toggle(!isApproved);
        }
        $mode.on('change', refreshMode);

        $body.append(
            $requirementsNote,
            makeField('Result', $mode),
            makeField('Nominator', $nominator),
            makeField('Article', $article),
            $articleHistoryNotice,
            $approvedFields,
            $declinedFields,
            $status
        );

        var dialog = new OO.ui.MessageDialog();
        var windowManager = new OO.ui.WindowManager();
        $('body').append(windowManager.$element);
        windowManager.addWindows([dialog]);

        async function preload() {
            try {
                $articleHistoryNotice.text('Loading article metadata…');

                var article = $article.val().trim();
                var oldest = await getOldestNonRedirectRevision(article);
                if (oldest) {
                    $creationDate.val(oldest.timestamp.slice(0, 10));
                    $creationDiffHolder.empty().append(linkNode(oldest.url, 'oldest non-redirect revision'));
                } else {
                    $creationDiffHolder.text('No non-redirect revision found automatically.');
                }

                var history = await getArticleHistoryData(article);
                $dykDate.val(history.dykDate);
                $gaDate.val(history.gaDate);
                $faDate.val(history.faDate);
                $articleHistoryNotice.empty().append(
                    $('<span>').text('Found {{Article history}} on '),
                    linkNode(mw.util.getUrl(history.talkTitle), history.talkTitle)
                );

                var count = await getExistingRecordCount(parsed.nominator);
                $previous4As.val(String(count));
            } catch (e) {
                $articleHistoryNotice.text(String(e.message || e));
            }
        }

        windowManager.openWindow(dialog, {
            title: 'Four Award helper — ' + parsed.article,
            message: $body,
            actions: [
                { action: 'cancel', label: 'Cancel', flags: 'safe' },
                { action: 'submit', label: 'Run', flags: ['primary', 'progressive'] }
            ],
            size: 'larger'
        }).closed.then(function (data) {
            if (!data || data.action !== 'submit') {
                return;
            }

            (async function () {
                try {
                    var payload = {
                        nominator: $nominator.val().trim(),
                        article: $article.val().trim(),
                        awardDate: $awardDate.val().trim(),
                        creationDate: $creationDate.val().trim(),
                        dykDate: $dykDate.val().trim(),
                        gaDate: $gaDate.val().trim(),
                        faDate: $faDate.val().trim(),
                        previous4As: Number($previous4As.val().trim() || '0'),
                        customMessage: $customMessage.val(),
                        declineReason: $declineReason.val(),
                        articleTalkPage: talkPageTitleForArticle($article.val().trim())
                    };

                    if (!payload.nominator || !payload.article) {
                        throw new Error('Nominator and article are required.');
                    }

                    if ($mode.val() === 'approved') {
                        if (!payload.creationDate || !payload.dykDate || !payload.gaDate || !payload.faDate || !payload.awardDate) {
                            throw new Error('All approved fields must be filled in before continuing.');
                        }
                        await processApproved(payload, ui, { rawText: nomination.text });
                    } else {
                        if (!payload.declineReason.trim()) {
                            throw new Error('A decline reason is required.');
                        }
                        await processDeclined(payload, ui, { rawText: nomination.text });
                    }
                } catch (err) {
                    showMessage($status, String(err.message || err), 'error');
                    mw.notify(String(err.message || err), { type: 'error' });
                }
            }());
        });

        refreshMode();
        preload();
    }

   function addLinksToRenderedNominations() {
        var $content = $('#mw-content-text .mw-parser-output');

        // Find nomination headers (user links in bold at start of each nom)
        $content.find('p > b > a').each(function () {
            var $userLink = $(this);
            var href = $userLink.attr('href') || '';
            var $p = $userLink.closest('p');
            var paragraphText = $p.text(); // Only use the nomination header line, not article/talk/history links
            if (!/\/wiki\/User:/i.test(href) || !/\(talk\s*·\s*contribs\)/i.test(paragraphText)) {
                    return;
            	  }

            // Avoid adding twice
            if ($userLink.next('.four-award-helper-link').length) {
                return;
            }

            var username = $userLink.text().trim();
            var $articleLink = $p.nextAll('p').find('a').filter(function () {
    return !$(this).attr('href').includes('User:') &&
           !$(this).attr('href').includes('Talk:') &&
           !$(this).attr('href').includes('Special:');}).first();
           var articleFromDOM = $articleLink.text().trim();

            var $link = $('<a>')
                .attr('href', '#')
                .addClass('four-award-helper-link')
                .css({ marginLeft: '0.5em', fontSize: '0.9em' })
                .text('[4A helper]');

            $link.on('click', async function (e) {
                e.preventDefault();
                try {
                    var fullText = await getPageWikitext(MAIN_PAGE);
                    var noms = CTBextractNominationsFromSection(fullText);

                    var targetNom = null;

                    for (var i = 0; i < noms.length; i++) {
                        var parsed = ctbParseNominationText(noms[i].text);
                        if (parsed.nominator === username &&parsed.article === articleFromDOM) {
                            targetNom = noms[i];
                            break;
                        }
                    }

                    if (!targetNom) {
                        throw new Error('Could not match this nomination to source wikitext.');
                    }

                    await openDialogForNomination(targetNom);
                } catch (err) {
                    mw.notify(String(err.message || err), { type: 'error' });
                }
            });

            $userLink.after($link);
        });
    }

    function init() {
        mw.loader.using([
            'mediawiki.api',
            'mediawiki.util',
            'oojs-ui',
            'oojs-ui.styles.icons-editing-core'
        ]).then(function () {
            addLinksToRenderedNominations();
            mw.notify('Four Award helper loaded.', { type: 'info', autoHide: true });
        });
    }

    $(init);
}());
