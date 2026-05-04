// <nowiki>
/*
 * PIA formal-discussion word counter
 *
 * Displays approximate per-editor word counts for formal discussions on
 * Palestine-Israel article talk pages. Inspired by:
 * - User:GoldenRing/wordcount.js
 * - User:L235/wordAndLinkCounter.js
 * - User:Novem Linguae/Scripts/VoteCounter.js
 *
 * The page filter intentionally mirrors the visible effect of
 * Special:AbuseFilter/1339: only enwiki talk pages that render the
 * Arab-Israeli conflict contentious-topic notice are considered.
 */
( function () {
	'use strict';

	var LIMIT = 1000;
	var SCRIPT_ID = 'pia-word-counter';
	var NOTICE_RE = /This page is currently subject to the contentious topics procedure.*Arab-Israeli conflict/i;
	var FORMAL_DISCUSSION_RE = /\{\{\s*(?:subst:\s*)?(?:rfc|requested move|requested move\/dated|requested move\/dated2|requested move\/dated multi|requested move\/dated multi\/sandbox)\b|^={2,6}\s*(?:rfc|request for comment|requested move|rm)\b/i;
	var TIMESTAMP_RE = /\d{1,2}:\d{2}, \d{1,2} [A-Z][a-z]+ \d{4} \(UTC\)/g;
	var USER_LINK_RE = /\[\[\s*(?:User(?: talk)?|Special:Contribs|Special:Contributions)[:/ ]\s*([^|\]#<>{}\n]+)(?:[|\]#]|\s*\]\])/ig;

	function isEnglishWikipedia() {
		return mw.config.get( 'wgDBname' ) === 'enwiki';
	}

	function shouldRunOnPage() {
		if ( !isEnglishWikipedia() || mw.config.get( 'wgAction' ) !== 'view' ) {
			return false;
		}

		var namespace = mw.config.get( 'wgNamespaceNumber' );
		if ( namespace !== 1 && namespace !== 119 ) {
			return false;
		}

		return NOTICE_RE.test( document.body.textContent || '' );
	}

	function addStyles() {
		mw.util.addCSS(
			'.pia-word-counter {' +
				'border: 1px solid #a2a9b1;' +
				'background: #f8f9fa;' +
				'font-size: 88%;' +
				'margin: 0.35em 0 0.8em;' +
				'padding: 0.45em 0.65em;' +
			'}' +
			'.pia-word-counter-title {' +
				'font-weight: bold;' +
				'margin-right: 0.5em;' +
			'}' +
			'.pia-word-counter-summary {' +
				'color: #54595d;' +
			'}' +
			'.pia-word-counter table {' +
				'border-collapse: collapse;' +
				'margin-top: 0.35em;' +
			'}' +
			'.pia-word-counter th, .pia-word-counter td {' +
				'border: 1px solid #c8ccd1;' +
				'padding: 0.16em 0.45em;' +
				'text-align: right;' +
			'}' +
			'.pia-word-counter th:first-child, .pia-word-counter td:first-child {' +
				'text-align: left;' +
			'}' +
			'.pia-word-counter-current {' +
				'font-weight: bold;' +
			'}' +
			'.pia-word-counter-near {' +
				'background: #fff4ce;' +
			'}' +
			'.pia-word-counter-over {' +
				'background: #fee7e6;' +
			'}' +
			'.pia-word-counter-note {' +
				'color: #54595d;' +
				'margin-top: 0.35em;' +
			'}'
		);
	}

	function htmlEscape( str ) {
		return String( str )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#039;' );
	}

	function normalizeUser( user ) {
		return String( user || '' )
			.replace( /_/g, ' ' )
			.replace( /^User(?: talk)?:/i, '' )
			.trim();
	}

	function stripHeadingMarkup( heading ) {
		return heading
			.replace( /^=+\s*/, '' )
			.replace( /\s*=+$/, '' )
			.replace( /<!--[\s\S]*?-->/g, '' )
			.replace( /\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1' )
			.replace( /\[\[:?([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1' )
			.replace( /'{2,5}/g, '' )
			.replace( /<[^>]+>/g, '' )
			.trim();
	}

	function getHeadingElements() {
		return Array.prototype.slice.call(
			document.querySelectorAll( '#mw-content-text .mw-parser-output h2, #mw-content-text .mw-parser-output h3, #mw-content-text .mw-parser-output h4, #mw-content-text .mw-parser-output h5, #mw-content-text .mw-parser-output h6' )
		);
	}

	function parseSections( wikicode ) {
		var matches = [];
		var re = /^(={2,6})\s*(.*?)\s*\1\s*$/gm;
		var match;

		while ( ( match = re.exec( wikicode ) ) !== null ) {
			matches.push( {
				start: match.index,
				endOfHeading: re.lastIndex,
				level: match[ 1 ].length,
				rawHeading: match[ 0 ],
				heading: stripHeadingMarkup( match[ 0 ] )
			} );
		}

		return matches.map( function ( section, index ) {
			var next = matches[ index + 1 ];
			return {
				headingIndex: index,
				level: section.level,
				heading: section.heading,
				wikicode: wikicode.slice( section.start, next ? next.start : wikicode.length )
			};
		} );
	}

	function isFormalDiscussion( section ) {
		var firstChunk = section.wikicode.slice( 0, 1400 );
		return FORMAL_DISCUSSION_RE.test( firstChunk );
	}

	function extractLastSigner( text ) {
		var match;
		var last = '';

		USER_LINK_RE.lastIndex = 0;
		while ( ( match = USER_LINK_RE.exec( text ) ) !== null ) {
			last = match[ 1 ];
		}

		return normalizeUser( last );
	}

	function stripTemplates( text ) {
		var previous;
		do {
			previous = text;
			text = text.replace( /\{\{[^{}]*\}\}/g, ' ' );
		} while ( text !== previous );
		return text;
	}

	function stripWikicodeForCount( text ) {
		return stripTemplates( text )
			.replace( /<!--[\s\S]*?-->/g, ' ' )
			.replace( /<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ' )
			.replace( /<ref\b[^/]*\/>/gi, ' ' )
			.replace( /<syntaxhighlight\b[\s\S]*?<\/syntaxhighlight>/gi, ' ' )
			.replace( /<source\b[\s\S]*?<\/source>/gi, ' ' )
			.replace( /<nowiki\b[^>]*>[\s\S]*?<\/nowiki>/gi, ' ' )
			.replace( /<[^>]+>/g, ' ' )
			.replace( /\[\[(?:File|Image|Category):[^\]]+\]\]/gi, ' ' )
			.replace( /\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1' )
			.replace( /\[\[:?([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1' )
			.replace( /\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1' )
			.replace( /https?:\/\/\S+/g, ' ' )
			.replace( /'{2,5}/g, '' )
			.replace( TIMESTAMP_RE, ' ' )
			.replace( /~~~~?/g, ' ' )
			.replace( /^[:*#;]+/gm, ' ' );
	}

	function countWords( text ) {
		var words = stripWikicodeForCount( text ).match( /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g );
		return words ? words.length : 0;
	}

	function countSectionByUser( sectionWikicode ) {
		var counts = {};
		var buffer = '';

		sectionWikicode.split( '\n' ).forEach( function ( line ) {
			buffer += line + '\n';

			if ( !TIMESTAMP_RE.test( line ) ) {
				TIMESTAMP_RE.lastIndex = 0;
				return;
			}
			TIMESTAMP_RE.lastIndex = 0;

			var user = extractLastSigner( buffer );
			if ( user ) {
				counts[ user ] = ( counts[ user ] || 0 ) + countWords( buffer );
			}
			buffer = '';
		} );

		return counts;
	}

	function getRowClass( user, words ) {
		var classes = [];
		if ( normalizeUser( user ).toLowerCase() === normalizeUser( mw.config.get( 'wgUserName' ) ).toLowerCase() ) {
			classes.push( 'pia-word-counter-current' );
		}
		if ( words > LIMIT ) {
			classes.push( 'pia-word-counter-over' );
		} else if ( words >= LIMIT * 0.8 ) {
			classes.push( 'pia-word-counter-near' );
		}
		return classes.join( ' ' );
	}

	function renderCounter( section ) {
		var counts = countSectionByUser( section.wikicode );
		var rows = Object.keys( counts )
			.map( function ( user ) {
				return { user: user, words: counts[ user ] };
			} )
			.filter( function ( row ) {
				return row.words > 0;
			} )
			.sort( function ( a, b ) {
				return b.words - a.words || a.user.localeCompare( b.user );
			} );

		if ( !rows.length ) {
			return '';
		}

		var overLimit = rows.filter( function ( row ) {
			return row.words > LIMIT;
		} ).length;
		var tableRows = rows.map( function ( row ) {
			var remaining = LIMIT - row.words;
			var remainingText = remaining >= 0 ? remaining.toLocaleString() : '+' + Math.abs( remaining ).toLocaleString();
			return '<tr class="' + getRowClass( row.user, row.words ) + '">' +
				'<td><a href="/wiki/User:' + encodeURIComponent( row.user.replace( / /g, '_' ) ) + '">' + htmlEscape( row.user ) + '</a></td>' +
				'<td>' + row.words.toLocaleString() + '</td>' +
				'<td>' + remainingText + '</td>' +
				'</tr>';
		} ).join( '' );

		return '<div class="pia-word-counter" role="note">' +
			'<span class="pia-word-counter-title">PIA word limit</span>' +
			'<span class="pia-word-counter-summary">' +
				rows.length.toLocaleString() + ' editor' + ( rows.length === 1 ? '' : 's' ) +
				', ' + overLimit.toLocaleString() + ' over ' + LIMIT.toLocaleString() +
			'</span>' +
			'<table>' +
				'<thead><tr><th>Editor</th><th>Words</th><th>Remaining</th></tr></thead>' +
				'<tbody>' + tableRows + '</tbody>' +
			'</table>' +
			'<div class="pia-word-counter-note">Approximate count from signed wikitext comments; struck, hidden, templated, and unsigned text may need manual checking.</div>' +
			'</div>';
	}

	function insertCounters( sections ) {
		var headings = getHeadingElements();
		sections.forEach( function ( section ) {
			var heading = headings[ section.headingIndex ];
			var html;

			if ( !heading || !isFormalDiscussion( section ) ) {
				return;
			}

			html = renderCounter( section );
			if ( html ) {
				$( heading ).after( html );
			}
		} );
	}

	async function getWikicode() {
		var oldid = mw.config.get( 'wgRevisionId' );
		var api = new mw.Api();
		var response;

		if ( !oldid ) {
			return '';
		}

		response = await api.get( {
			action: 'parse',
			oldid: oldid,
			prop: 'wikitext',
			formatversion: 2
		} );

		return response.parse && response.parse.wikitext || '';
	}

	async function execute() {
		var wikicode;
		var sections;

		if ( document.getElementById( SCRIPT_ID ) || !shouldRunOnPage() ) {
			return;
		}

		$( '<span id="' + SCRIPT_ID + '" style="display:none"></span>' ).appendTo( document.body );
		addStyles();
		wikicode = await getWikicode();
		sections = parseSections( wikicode );
		insertCounters( sections );
	}

	mw.loader.using( [ 'mediawiki.api', 'mediawiki.util', 'jquery' ] ).then( function () {
		$( execute );
	} );
}() );
// </nowiki>
