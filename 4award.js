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

if (mw.config.get('wgPageName') !== 'Wikipedia:Four_Award') return;

const RECORDS_PAGE = 'Wikipedia:Four Award/Records';
const MAIN_PAGE = 'Wikipedia:Four Award';
const LOG_PAGE = 'User:' + mw.config.get('wgUserName') + '/4award/log';

mw.loader.using(['@wikimedia/codex']).then(function (require) {

const Vue = require('vue');
const Codex = require('@wikimedia/codex');

const { CdxDialog, CdxButton, CdxTextInput } = Codex;
const api = new mw.Api();

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

/* ================= API ================= */

async function getWikitext(title){
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
    if(!url) return {date:'',status:''};

    try{
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
    await api.postWithEditToken({
        action:'edit',
        title:LOG_PAGE,
        appendtext:`\n== ${type} ==\n<nowiki>${row}</nowiki>`,
        summary: withTag('Logging ' + type)
    });
}

async function approve(data){

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

    const h4 = section.is('h4') ? section : section.children('h4').first();

    let userLink=h4.find('a[title^="User:"]').first();
    let user=userLink.attr('title')
        ? userLink.attr('title').replace(/^User:/,'').trim()
        : (h4.attr('id') || h4.find('.mw-headline').attr('id') || '')
            .replace(/_/g,' ')
            .replace(/\s*\(talk.*$/i,'')
            .trim();

    let content=section.is('h4')
        ? section.nextUntil('h4')
        : section.nextUntil('.mw-heading4');

    let article=content.find('b:contains("Article:")')
        .first()
        .nextAll('a[href^="/wiki/"]:not([href*="Wikipedia:"]):not([href*="User:"]):not([href*="Special:"])')
        .first()
        .attr('title')||'';

    if(!article){
        article=content.find('a[href^="/wiki/"]:not([href*="Wikipedia:"]):not([href*="User:"]):not([href*="Special:"]):not([href*="Talk:"])')
            .first().attr('title')||'';
    }

    return {
        user,
        article,
        dyk:content.find('a[href*="Did_you_know"]').attr('href'),
        fac:content.find('a[href*="Featured_article_candidates"]').attr('href')
    };
}

/* ================= UI ================= */

function openDialog(data){

    const mount=document.body.appendChild(document.createElement('div'));

    Vue.createMwApp({
        components:{CdxDialog,CdxButton,CdxTextInput},

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
            this.creationDate=await getCreationDate(this.article);
            this.dykDate=parseDYK(data.dyk);
            this.gaDate=await parseGA(this.article);
            let fac=await parseFAC(data.fac,this.article);
            this.faDate=fac.date;
        },

        methods:{
            async run(){
                try{
                    await approve(this);
                    mw.notify('Done');
                    this.open=false;
                    mount.remove();
                }catch(e){
                    mw.notify('Four Award helper failed: ' + (e?.error?.info || e?.message || e), {type:'error'});
                }
            }
        },

template:`
<CdxDialog v-model:open="open" title="Four Award">

<CdxTextInput v-model="user" disabled/>
<CdxTextInput v-model="article" disabled/>

<CdxTextInput v-model="awardDate"/>
<CdxTextInput v-model="creationDate"/>
<CdxTextInput v-model="dykDate"/>
<CdxTextInput v-model="gaDate"/>
<CdxTextInput v-model="faDate"/>

<pre>{{preview}}</pre>

<CdxButton @click="run" action="progressive">Run</CdxButton>

</CdxDialog>
`
    }).mount(mount);
}

/* ================= INIT ================= */

let nominationSections=$('#mw-content-text .mw-parser-output > .mw-heading4');
if(!nominationSections.length){
    nominationSections=$('#mw-content-text .mw-parser-output > h4');
}

nominationSections.each(function(){

    const section=$(this);
    const data=extractNomination(section);
    const h4=section.is('h4') ? section : section.children('h4').first();

    if(!data.user || !data.article || !h4.length) return;

    const btn=$('<a href="#"> [4A]</a>');
    btn.click(e=>{
        e.preventDefault();
        openDialog(data);
    });

    h4.append(btn);
});

});
});
