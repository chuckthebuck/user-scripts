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

const DEBUG = true;
const DEBUG_PREFIX = '[FourAwardHelper]';

function debug(){
    if(DEBUG && window.console){
        console.log(DEBUG_PREFIX, ...arguments);
    }
}

function warn(){
    if(window.console){
        console.warn(DEBUG_PREFIX, ...arguments);
    }
}

function error(){
    if(window.console){
        console.error(DEBUG_PREFIX, ...arguments);
    }
}

debug('loaded', {
    pageName: mw.config.get('wgPageName'),
    action: mw.config.get('wgAction'),
    oldid: mw.config.get('wgRevisionId'),
    url: location.href
});

if (mw.config.get('wgPageName') !== 'Wikipedia:Four_Award') {
    debug('stopping: not Wikipedia:Four_Award');
    return;
}

const RECORDS_PAGE = 'Wikipedia:Four Award/Records';
const MAIN_PAGE = 'Wikipedia:Four Award';
const LOG_PAGE = 'User:' + mw.config.get('wgUserName') + '/4award/log';

let codexPromise;
let apiPromise;

function getApi(){
    if(!apiPromise){
        debug('loading mediawiki.api');
        apiPromise=mw.loader.using(['mediawiki.api']).then(function(){
            debug('mediawiki.api loaded');
            return new mw.Api();
        }).catch(function(e){
            error('mediawiki.api failed to load', e);
            throw e;
        });
    }
    return apiPromise;
}

function loadCodex(){
    if(!codexPromise){
        debug('loading @wikimedia/codex');
        codexPromise=mw.loader.using(['@wikimedia/codex']).then(function(require){
            const Vue=require('vue');
            const Codex=require('@wikimedia/codex');
            debug('@wikimedia/codex loaded', {
                hasVue: !!Vue,
                hasDialog: !!Codex.CdxDialog,
                hasButton: !!Codex.CdxButton,
                hasTextInput: !!Codex.CdxTextInput
            });
            return {
                Vue,
                CdxDialog: Codex.CdxDialog,
                CdxButton: Codex.CdxButton,
                CdxTextInput: Codex.CdxTextInput
            };
        }).catch(function(e){
            error('@wikimedia/codex failed to load', e);
            throw e;
        });
    }
    return codexPromise;
}

/* ================= UTIL ================= */
function withTag(summary){
    return summary + ' ([[User:Alachuckthebuck/FourAwardHelper|FourAwardHelper]])';
}
function today(){ return new Date().toISOString().slice(0,10); }

function toDts(d){
    if(!d) return '';
    let m=d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `{{dts|${m[1]}|${m[2]}|${m[3]}}}` : d;
}

function buildRow(d){
    return `|- || [[User:${d.user}]] || [[${d.article}]] || ${toDts(d.awardDate)} || ${toDts(d.creationDate)} || ${toDts(d.dykDate)} || ${toDts(d.gaDate)} || ${toDts(d.faDate)}`;
}

function normalizeUser(u){
    return String(u||'').toLowerCase().replace(/_/g,' ').trim();
}

function getLinkTitle(link){
    let $link=$(link);
    let title=$link.attr('title');
    if(title) return title;

    let href=$link.attr('href') || '';
    let m=href.match(/\/wiki\/([^?#]+)/);
    return m ? decodeURIComponent(m[1]).replace(/_/g,' ') : '';
}

function isArticleTitle(title){
    return title && !/^(Wikipedia|User|User talk|Talk|Special|File|Help|Template|Category):/i.test(title);
}

function firstArticleTitle(root){
    let found='';
    let count=0;
    root.find('a[href*="/wiki/"]').each(function(){
        count++;
        let title=getLinkTitle(this);
        if(isArticleTitle(title)){
            found=title;
            return false;
        }
    });
    debug('firstArticleTitle result', {found, candidateLinks: count, text: root.text().trim().slice(0,120)});
    return found;
}

function firstHrefMatching(root, pattern){
    let href='';
    let count=0;
    root.find('a[href]').each(function(){
        count++;
        let link=$(this).attr('href') || '';
        if(pattern.test(link)){
            href=link;
            return false;
        }
    });
    debug('firstHrefMatching result', {pattern: String(pattern), href, candidateLinks: count});
    return href;
}

/* ================= API ================= */

async function getWikitext(title){
    debug('getWikitext start', title);
    let api=await getApi();
    let r = await api.get({
        action:'query',
        prop:'revisions',
        rvslots:'main',
        rvprop:'content',
        titles:title,
        formatversion:2
    });
    return r.query.pages[0].revisions[0].slots.main.content;
}

async function edit(title,text,summary){
    debug('edit start', {title, summary, textLength: text.length});
    let api=await getApi();
    return api.postWithEditToken({
        action:'edit',
        title,
        text,
        summary: withTag(summary)
    });
}

/* ================= TABLE ================= */

function recordExists(text,user,article){
    let uNorm=normalizeUser(user);
    return text.split('\n').some(l=>{
        let u=l.match(/\[\[User:([^|\]]+)/i);
        let a=l.match(/\[\[([^\]|]+)/);
        return u && a &&
            normalizeUser(u[1])===uNorm &&
            a[1]===article;
    });
}

function getNextCount(text,user){
    let max=0, norm=normalizeUser(user);
    text.split('\n').forEach(l=>{
        let u=l.match(/\[\[User:([^|\]]+)/i);
        if(!u || normalizeUser(u[1])!==norm) return;
        let m=l.match(/\((\d+)\)/);
        if(m) max=Math.max(max,+m[1]);
        else max=Math.max(max,1);
    });
    return max+1;
}

function insertRow(text,row){
    let lines=text.split('\n');
    let end=lines.findIndex(l=>l.trim()==='|}');
    lines.splice(end,0,row);
    return lines.join('\n');
}

/* ================= DATES ================= */

async function getCreationDate(article){
    debug('getCreationDate start', article);
    let api=await getApi();
    let r=await api.get({
        action:'query',
        prop:'revisions',
        titles:article,
        rvlimit:1,
        rvdir:'newer',
        rvprop:'timestamp',
        formatversion:2
    });
    return r?.query?.pages?.[0]?.revisions?.[0]?.timestamp?.slice(0,10)||'';
}

function parseDYK(url){
    let m=url?.match(/(\d{4})\/([A-Za-z]+)#(\d{1,2})_/);
    return m?new Date(`${m[2]} ${m[3]}, ${m[1]}`).toISOString().slice(0,10):'';
}

async function parseGA(article){
    debug('parseGA start', article);
    let api=await getApi();
    let r=await api.get({
        action:'query',
        prop:'revisions',
        titles:article,
        rvlimit:200,
        rvprop:'timestamp|user|comment',
        rvdir:'newer',
        formatversion:2
    });

    let revs=r?.query?.pages?.[0]?.revisions||[];

    for(let rev of revs){
        if(rev.user==='ChristieBot' || /good article/i.test(rev.comment||'')){
            return rev.timestamp.slice(0,10);
        }
    }
    return '';
}

async function parseFAC(url,article){
    debug('parseFAC start', {url, article});
    if(!url) return {date:'',status:''};

    try{
        let api=await getApi();
        let title=url.includes('title=')
            ? decodeURIComponent(url.match(/title=([^&]+)/)[1])
            : decodeURIComponent(url.split('/wiki/')[1]);

        let r=await api.get({
            action:'parse',
            page:title,
            prop:'wikitext',
            formatversion:2
        });

        let text=r.parse.wikitext;

        let status=/promoted/i.test(text)?'promoted':'';

        let m=text.match(/promoted.*?(\d{1,2} [A-Za-z]+ \d{4})/i);

        return {
            status,
            date:m?new Date(m[1]).toISOString().slice(0,10):''
        };

    }catch(e){
        return {date:'',status:''};
    }
}

/* ================= ACTIONS ================= */

async function notifyUser(user, article){
    debug('notifyUser start', {user, article});
    let api=await getApi();

    var talkText = `
{| style="border: 1px solid gray; background-color: #fdffe7;"
|rowspan="2" style="vertical-align:middle;" | 
[[File:Four Award with draft icon.svg|100px]]
|rowspan="2" |
|style="font-size: x-large; padding: 0; vertical-align: middle; height: 1.1em;" | '''Four Award'''
|-
|style="vertical-align: middle; border-top: 1px solid gray;" | Congratulations! You have been awarded the [[Wikipedia:Four Award|Four Award]] for your work from beginning to end on '''[[${article}]]'''. <span style="font-family:Courier">All the Best</span> -- [[User:Alachuckthebuck|<b style="color: #605252">Chuck</b>]] <b><sup>[[User_talk:Alachuckthebuck|<span style="color: #8c593a; font-family: Tahoma">Talk</span>]]</sup></b> 00:39, 2 April 2026 (UTC) 
|}`;
    var talkSectionTitle = 'Four Award for ' + article;

    await api.postWithEditToken({
        action:'edit',
        title:'User talk:'+user,
        section:'new',
        sectiontitle: talkSectionTitle,
        text: talkText,
        summary: withTag('Notifying user of Four Award for [[' + article + ']]')
    });
}
    	
    


async function logAction(type,row){
    debug('logAction start', {type, row});
    let api=await getApi();
    await api.postWithEditToken({
        action:'edit',
        title:LOG_PAGE,
        appendtext:`\n== ${type} ==\n<nowiki>${row}</nowiki>`,
        summary: withTag('Logging ' + type)
    });
}

async function approve(data){
    debug('approve start', {
        user:data.user,
        article:data.article,
        awardDate:data.awardDate,
        creationDate:data.creationDate,
        dykDate:data.dykDate,
        gaDate:data.gaDate,
        faDate:data.faDate
    });

    let records=await getWikitext(RECORDS_PAGE);

    if(recordExists(records,data.user,data.article))
        throw 'Duplicate';

    let row=buildRow(data);
    let updated=insertRow(records,row);

    await edit(RECORDS_PAGE,updated,'Adding Four Award for [['+data.article+']]');

    await notifyUser(data.user,data.article);
    await logAction('Approved',row);
}

/* ================= PARSER ================= */

function extractNomination(section){
    debug('extractNomination start', section.get(0));

    const h4 = section.is('h4') ? section : section.children('h4').first();

    let userLink=h4.find('a[href*="/wiki/User:"], a[title^="User:"]').first();
    let user=getLinkTitle(userLink)
        ? getLinkTitle(userLink).replace(/^User:/,'').trim()
        : (h4.attr('id') || h4.find('.mw-headline').attr('id') || '')
            .replace(/_/g,' ')
            .replace(/\s*\(talk.*$/i,'')
            .trim();

    let content=section.is('h4')
        ? section.nextUntil('h4')
        : section.nextUntil('.mw-heading4');

    let article='';
    let articleLine=content.filter(function(){
        return $(this).text().includes('Article:');
    }).first();

    if(!articleLine.length){
        articleLine=content.find('b:contains("Article:")').first().parent();
    }

    article=firstArticleTitle(articleLine);

    if(!article){
        article=firstArticleTitle(content);
    }

    let data={
        user,
        article,
        dyk:firstHrefMatching(content,/Did_you_know/i),
        ga:firstHrefMatching(content,/\/GA\d*($|[?#])/i),
        fac:firstHrefMatching(content,/Featured_article_candidates/i)
    };
    debug('extractNomination result', data);
    return data;
}

function extractNominationFromArticleLine(articleLine){
    let p=$(articleLine);
    debug('extractNominationFromArticleLine start', {
        text: p.text().trim(),
        element: articleLine
    });
    let heading=p.prevAll('.mw-heading4, h4').first();
    let h4=heading.is('h4') ? heading : heading.find('h4').first();
    let content=p.add(p.nextUntil('.mw-heading4, h4'));

    let userLink=h4.find('a[href*="/wiki/User:"], a[title^="User:"]').first();
    let user=getLinkTitle(userLink)
        ? getLinkTitle(userLink).replace(/^User:/,'').trim()
        : (h4.attr('id') || h4.find('.mw-headline').attr('id') || '')
            .replace(/_/g,' ')
            .replace(/\s*\(talk.*$/i,'')
            .trim();

    let result={
        heading,
        h4,
        data:{
            user,
            article:firstArticleTitle(p),
            dyk:firstHrefMatching(content,/Did_you_know/i),
            ga:firstHrefMatching(content,/\/GA\d*($|[?#])/i),
            fac:firstHrefMatching(content,/Featured_article_candidates/i)
        }
    };
    debug('extractNominationFromArticleLine result', {
        headingFound: !!heading.length,
        h4Found: !!h4.length,
        headingText: h4.text().trim(),
        data: result.data
    });
    return result;
}

/* ================= UI ================= */

async function openDialog(data){
    debug('openDialog start', data);

    const mount=document.body.appendChild(document.createElement('div'));
    const { Vue, CdxDialog, CdxButton, CdxTextInput }=await loadCodex();

    Vue.createMwApp({
        components:{
            'cdx-dialog': CdxDialog,
            'cdx-button': CdxButton,
            'cdx-text-input': CdxTextInput
        },

        data(){
            return{
                open:true,
                user:data.user,
                article:data.article,
                creationDate:'',
                dykDate:'',
                gaDate:'',
                faDate:'',
                awardDate:today()
            };
        },

        computed:{
            preview(){ return buildRow(this); }
        },

        async mounted(){
            debug('dialog mounted', {
                user:this.user,
                article:this.article,
                rawDyk:data.dyk,
                rawGa:data.ga,
                rawFac:data.fac
            });
            try{
                this.creationDate=await getCreationDate(this.article);
                this.dykDate=parseDYK(data.dyk);
                this.gaDate=await parseGA(this.article);
                let fac=await parseFAC(data.fac,this.article);
                this.faDate=fac.date;
                debug('dialog date population complete', {
                    creationDate:this.creationDate,
                    dykDate:this.dykDate,
                    gaDate:this.gaDate,
                    faDate:this.faDate
                });
            }catch(e){
                error('dialog date population failed', e);
                mw.notify('Four Award helper date lookup failed: ' + (e?.message || e), {type:'warn'});
            }
        },

        methods:{
            async run(){
                try{
                    await approve(this);
                    mw.notify('Done');
                    this.open=false;
                    mount.remove();
                }catch(e){
                    error('run failed', e);
                    mw.notify('Four Award helper failed: ' + (e?.error?.info || e?.message || e), {type:'error'});
                }
            }
        },

template:`
<cdx-dialog v-model:open="open" title="Four Award">

<cdx-text-input v-model="user"></cdx-text-input>
<cdx-text-input v-model="article"></cdx-text-input>

<cdx-text-input v-model="awardDate"></cdx-text-input>
<cdx-text-input v-model="creationDate"></cdx-text-input>
<cdx-text-input v-model="dykDate"></cdx-text-input>
<cdx-text-input v-model="gaDate"></cdx-text-input>
<cdx-text-input v-model="faDate"></cdx-text-input>

<pre>{{preview}}</pre>

<cdx-button @click="run" action="progressive">Run</cdx-button>

</cdx-dialog>
`
    }).mount(mount);
}

/* ================= INIT ================= */

function initFourAwardHelper($content){
    debug('initFourAwardHelper start', {
        contentLength: $content.length,
        contentTextStart: $content.text().trim().slice(0,120),
        currentLinks: $('.four-award-helper-link').length
    });
    let articleLines=$content.find('.mw-parser-output p, p').filter(function(){
        return /^Article:\s*/i.test($(this).text().trim());
    });
    debug('article lines found', {
        count: articleLines.length,
        lines: articleLines.map(function(){ return $(this).text().trim().slice(0,160); }).get()
    });

    articleLines.each(function(){

        const parsed=extractNominationFromArticleLine(this);
        const data=parsed.data;
        const h4=parsed.h4;

        if(!h4.length){
            warn('skipping article line: no heading found', {data, line: $(this).text().trim()});
            return;
        }
        if(h4.find('.four-award-helper-link').length){
            debug('skipping article line: link already present', h4.text().trim());
            return;
        }

        if(!data.user || !data.article){
            warn('found a nomination but could not extract all data', data, h4.text());
        }

        const btn=$('<a href="#" class="four-award-helper-link"> [4A]</a>');
        btn.click(async e=>{
            e.preventDefault();
            try{
                await openDialog(data);
            }catch(err){
                error('openDialog failed', err);
                mw.notify('Four Award helper failed to open: ' + (err?.message || err), {type:'error'});
            }
        });

        h4.append(btn);
        debug('appended [4A]', {heading: h4.text().trim(), data});
    });
    debug('initFourAwardHelper done', {
        finalLinks: $('.four-award-helper-link').length
    });
}

mw.hook('wikipage.content').add(initFourAwardHelper);
$(function(){
    debug('DOM ready callback');
    initFourAwardHelper($('#mw-content-text'));
});
});
