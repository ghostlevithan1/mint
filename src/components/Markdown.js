import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import { CODE_INLINE_LIMIT, TEXT_FILE_LIMIT, describeFence, downloadTextFile, } from '../lib/generatedFiles';
import { isImageLine, isImageUrl } from '../lib/imageLinks';
import { PlotImage } from './PlotImage';
import { DiagramView } from './DiagramView';
import { RemoteImage } from './RemoteImage';
// KaTeX is ~270 KB of JavaScript. Load it only when a message contains math.
let katexPromise = null;
function loadKatex() {
    if (!katexPromise) {
        katexPromise = import('katex').then((module) => module.default);
    }
    return katexPromise;
}
/** Renders TeX through KaTeX and falls back to readable source on errors. */
function MathNode({ tex, display, block = false, }) {
    const [katex, setKatex] = useState(null);
    useEffect(() => {
        let active = true;
        loadKatex()
            .then((module) => {
            if (active)
                setKatex(() => module);
        })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);
    if (!katex) {
        return (_jsx("code", { className: `math-fallback${display ? ' math-fallback-display' : ''}`, children: display ? `\\[${tex}\\]` : `\\(${tex}\\)` }));
    }
    let html = '';
    try {
        html = katex.renderToString(tex, {
            displayMode: display,
            throwOnError: false,
            strict: false,
            trust: false,
        });
    }
    catch {
        return (_jsx("code", { className: "math-fallback", children: display ? `\\[${tex}\\]` : `\\(${tex}\\)` }));
    }
    const className = block
        ? 'math-block-inner'
        : display
            ? 'math-display'
            : 'math-inline';
    return (_jsx("span", { className: className, 
        // KaTeX escapes the input and emits its own trusted markup.
        dangerouslySetInnerHTML: { __html: html } }));
}
/** Inline `$…$` is only treated as math when it does not look like money. */
function looksLikeInlineMath(value) {
    if (!value || /^\s|\s$/.test(value))
        return false;
    return /[\\a-zA-Z^_{}=+\-*/<>]/.test(value);
}
function tokenizeInline(text) {
    const tokens = [];
    let buffer = '';
    let index = 0;
    const flush = () => {
        if (!buffer)
            return;
        tokens.push({ type: 'text', value: buffer });
        buffer = '';
    };
    while (index < text.length) {
        if (text[index] === '`') {
            const end = text.indexOf('`', index + 1);
            if (end > index + 1) {
                flush();
                tokens.push({ type: 'code', value: text.slice(index + 1, end) });
                index = end + 1;
                continue;
            }
        }
        if (text[index] === '[') {
            const closeBracket = text.indexOf('](', index + 1);
            const closeParen = closeBracket > index ? text.indexOf(')', closeBracket + 2) : -1;
            if (closeBracket > index + 1 && closeParen > closeBracket) {
                const label = text.slice(index + 1, closeBracket).trim();
                const url = text.slice(closeBracket + 2, closeParen).trim();
                if (/^https?:\/\/\S+$/i.test(url) && !label.includes('](')) {
                    flush();
                    tokens.push({ type: 'link', url, label: label || url });
                    index = closeParen + 1;
                    continue;
                }
            }
        }
        if (text.startsWith('![', index)) {
            const closeBracket = text.indexOf('](', index + 2);
            const closeParen = closeBracket > index ? text.indexOf(')', closeBracket + 2) : -1;
            if (closeBracket > index + 2 && closeParen > closeBracket) {
                const alt = text.slice(index + 2, closeBracket).trim();
                const url = text.slice(closeBracket + 2, closeParen).trim();
                if (isImageUrl(url)) {
                    flush();
                    tokens.push({ type: 'image', url, alt: alt || 'Image' });
                    index = closeParen + 1;
                    continue;
                }
            }
        }
        if (text.startsWith('**', index)) {
            const end = text.indexOf('**', index + 2);
            if (end > index + 2) {
                flush();
                tokens.push({ type: 'strong', value: text.slice(index + 2, end) });
                index = end + 2;
                continue;
            }
        }
        // *emphasis*: the opening star hugs a word and is not inside one, so
        // arithmetic such as 2 * 3 or 2*3*4 stays plain text.
        if (text[index] === '*' &&
            text[index + 1] !== '*' &&
            /\S/.test(text[index + 1] ?? ' ') &&
            !/[\p{L}\p{N}]/u.test(text[index - 1] ?? ' ')) {
            const end = text.indexOf('*', index + 1);
            if (end > index + 1 && /\S/.test(text[end - 1]) && text[end + 1] !== '*') {
                flush();
                tokens.push({ type: 'em', value: text.slice(index + 1, end) });
                index = end + 1;
                continue;
            }
        }
        if (text.startsWith('\\(', index)) {
            const end = text.indexOf('\\)', index + 2);
            if (end > index + 2) {
                flush();
                tokens.push({ type: 'math', value: text.slice(index + 2, end), display: false });
                index = end + 2;
                continue;
            }
        }
        if (text.startsWith('\\[', index)) {
            const end = text.indexOf('\\]', index + 2);
            if (end > index + 2) {
                flush();
                tokens.push({ type: 'math', value: text.slice(index + 2, end), display: true });
                index = end + 2;
                continue;
            }
        }
        if (text.startsWith('$$', index)) {
            const end = text.indexOf('$$', index + 2);
            if (end > index + 2) {
                flush();
                tokens.push({ type: 'math', value: text.slice(index + 2, end), display: true });
                index = end + 2;
                continue;
            }
        }
        if (text[index] === '$') {
            const end = text.indexOf('$', index + 1);
            if (end > index + 1) {
                const value = text.slice(index + 1, end);
                const previous = index > 0 ? text[index - 1] : '';
                const next = end + 1 < text.length ? text[end + 1] : '';
                if (looksLikeInlineMath(value) &&
                    !/\d/.test(previous) &&
                    !/\d/.test(next)) {
                    flush();
                    tokens.push({ type: 'math', value, display: false });
                    index = end + 1;
                    continue;
                }
            }
        }
        buffer += text[index];
        index += 1;
    }
    flush();
    return tokens;
}
function inline(text, keyPrefix) {
    return tokenizeInline(text).map((token, index) => {
        const key = `${keyPrefix}-${index}`;
        if (token.type === 'strong') {
            return _jsx("strong", { children: inline(token.value, key) }, key);
        }
        if (token.type === 'em') {
            return _jsx("em", { children: inline(token.value, key) }, key);
        }
        if (token.type === 'code') {
            return _jsx("code", { children: token.value }, key);
        }
        if (token.type === 'link') {
            return (_jsx("a", { href: token.url, target: "_blank", rel: "noreferrer noopener", children: token.label }, key));
        }
        if (token.type === 'math') {
            return _jsx(MathNode, { tex: token.value, display: token.display }, key);
        }
        if (token.type === 'image') {
            return (_jsx("a", { className: "markdown-inline-image", href: token.url, target: "_blank", rel: "noreferrer noopener", title: token.alt, children: _jsx("img", { src: token.url, alt: token.alt, loading: "lazy", decoding: "async", referrerPolicy: "no-referrer" }) }, key));
        }
        return _jsx("span", { children: token.value }, key);
    });
}
function CodeFileCard({ code, info }) {
    const [copied, setCopied] = useState(false);
    const oversize = code.length >= CODE_INLINE_LIMIT;
    const compact = !oversize && code.length < TEXT_FILE_LIMIT;
    const kb = Math.max(1, Math.round(code.length / 1024));
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        }
        catch {
            setCopied(false);
        }
    };
    return (_jsxs("figure", { className: `file-card ${oversize ? 'is-oversize' : compact ? 'is-compact' : 'is-large'}`, children: [_jsxs("figcaption", { className: "file-card-head", children: [_jsx("span", { className: "file-card-icon", "aria-hidden": "true", children: _jsx(FileCode2, { size: 13 }) }), _jsx("span", { className: "file-card-name", title: info.filename, children: info.filename }), _jsxs("span", { className: "file-card-meta", children: [info.language, " \u00B7 ", code.length.toLocaleString(), " chars"] }), _jsxs("span", { className: "file-card-actions", children: [_jsxs("button", { type: "button", onClick: () => void copy(), title: "Copy file contents", children: [copied ? _jsx(Check, { size: 12 }) : _jsx(Copy, { size: 12 }), copied ? 'Copied' : 'Copy'] }), _jsxs("button", { type: "button", onClick: () => downloadTextFile(info.filename, code, info.extension), title: `Download ${info.filename}`, children: [_jsx(Download, { size: 12 }), "Download"] })] })] }), oversize ? (_jsxs("div", { className: "file-card-note", children: [_jsx(FileCode2, { size: 13 }), _jsxs("p", { children: ["This file is ~", kb, " KB \u2014 too long to show in chat. Download it to view the full", ' ', code.length.toLocaleString(), " characters; nothing is cut off."] })] })) : (_jsx("pre", { children: _jsx("code", { children: code }) }))] }));
}
/** Reads a `$$…$$` or `\[…\]` block, including multi-line bodies. */
function readDisplayMath(lines, start, open, close) {
    const afterOpen = lines[start].trim().slice(open.length).trim();
    if (afterOpen.includes(close)) {
        return { tex: afterOpen.slice(0, afterOpen.indexOf(close)).trim(), next: start };
    }
    const body = afterOpen ? [afterOpen] : [];
    for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        const closeAt = line.indexOf(close);
        if (closeAt >= 0) {
            const before = line.slice(0, closeAt).trim();
            if (before)
                body.push(before);
            return { tex: body.join('\n').trim(), next: cursor };
        }
        body.push(line);
    }
    return { tex: body.join('\n').trim(), next: lines.length - 1 };
}
function parseBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];
    let paragraph = [];
    const flushParagraph = () => {
        if (!paragraph.length)
            return;
        blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
        paragraph = [];
    };
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) {
            flushParagraph();
            continue;
        }
        const imageRef = isImageLine(trimmed);
        if (imageRef) {
            flushParagraph();
            blocks.push({ type: 'image', ...imageRef });
            continue;
        }
        if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
            flushParagraph();
            const open = trimmed.startsWith('$$') ? '$$' : '\\[';
            const close = open === '$$' ? '$$' : '\\]';
            const { tex, next } = readDisplayMath(lines, index, open, close);
            blocks.push({ type: 'math', tex });
            index = next;
            continue;
        }
        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
            flushParagraph();
            const fence = trimmed.slice(0, 3);
            const info = trimmed.slice(3).trim();
            const codeLines = [];
            let cursor = index + 1;
            while (cursor < lines.length && !lines[cursor].trim().startsWith(fence)) {
                codeLines.push(lines[cursor]);
                cursor += 1;
            }
            const language = info.split(/\s+/)[0]?.toLowerCase() ?? '';
            if (language === 'plot' || language === 'diagram') {
                // An unclosed fence is still streaming, so its JSON is not complete yet.
                blocks.push({ type: language, code: codeLines.join('\n'), open: cursor >= lines.length });
            }
            else {
                blocks.push({
                    type: 'code',
                    code: codeLines.join('\n'),
                    info: describeFence(info, index),
                });
            }
            index = cursor;
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
            flushParagraph();
            blocks.push({ type: 'heading', level: heading[1].length <= 2 ? 2 : 3, text: heading[2] });
            continue;
        }
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            flushParagraph();
            blocks.push({ type: 'rule' });
            continue;
        }
        if (trimmed.startsWith('> ')) {
            flushParagraph();
            blocks.push({ type: 'quote', text: trimmed.slice(2) });
            continue;
        }
        const BULLET = /^[-*+]\s+/;
        if (BULLET.test(trimmed)) {
            flushParagraph();
            const items = [];
            let cursor = index;
            while (cursor < lines.length && BULLET.test(lines[cursor].trim())) {
                items.push(lines[cursor].trim().replace(BULLET, ''));
                cursor += 1;
            }
            blocks.push({ type: 'bullets', items });
            index = cursor - 1;
            continue;
        }
        const NUMBERED = /^(\d+)[.)]\s+/;
        const numbered = NUMBERED.exec(trimmed);
        if (numbered) {
            flushParagraph();
            const items = [];
            let cursor = index;
            while (cursor < lines.length && NUMBERED.test(lines[cursor].trim())) {
                items.push(lines[cursor].trim().replace(NUMBERED, ''));
                cursor += 1;
            }
            // Keep the author's numbering when display maths or prose splits a list.
            blocks.push({ type: 'numbers', items, start: Number(numbered[1]) });
            index = cursor - 1;
            continue;
        }
        if (trimmed.startsWith('|')) {
            flushParagraph();
            const rows = [];
            let cursor = index;
            while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
                const cells = lines[cursor]
                    .trim()
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split('|')
                    .map((cell) => cell.trim());
                if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
                    rows.push(cells);
                cursor += 1;
            }
            blocks.push({ type: 'table', rows });
            index = cursor - 1;
            continue;
        }
        paragraph.push(trimmed);
    }
    flushParagraph();
    return blocks;
}
export const Markdown = memo(function Markdown({ text }) {
    const blocks = useMemo(() => parseBlocks(text), [text]);
    return (_jsx("div", { className: "markdown", children: blocks.map((block, index) => {
            if (block.type === 'heading') {
                if (block.level === 2) {
                    return _jsx("h3", { children: inline(block.text, `h-${index}`) }, index);
                }
                return _jsx("h4", { children: inline(block.text, `h-${index}`) }, index);
            }
            if (block.type === 'paragraph') {
                return _jsx("p", { children: inline(block.text, `p-${index}`) }, index);
            }
            if (block.type === 'bullets') {
                return (_jsx("ul", { children: block.items.map((item, itemIndex) => (_jsx("li", { children: inline(item, `b-${index}-${itemIndex}`) }, itemIndex))) }, index));
            }
            if (block.type === 'numbers') {
                return (_jsx("ol", { start: block.start === 1 ? undefined : block.start, children: block.items.map((item, itemIndex) => (_jsx("li", { children: inline(item, `n-${index}-${itemIndex}`) }, itemIndex))) }, index));
            }
            if (block.type === 'rule') {
                return _jsx("hr", {}, index);
            }
            if (block.type === 'quote') {
                return _jsx("blockquote", { children: inline(block.text, `q-${index}`) }, index);
            }
            if (block.type === 'math') {
                return (_jsx("div", { className: "math-block", children: _jsx(MathNode, { tex: block.tex, display: true, block: true }) }, index));
            }
            if (block.type === 'code') {
                return _jsx(CodeFileCard, { code: block.code, info: block.info }, index);
            }
            if (block.type === 'image') {
                return _jsx(RemoteImage, { url: block.url, alt: block.alt }, index);
            }
            if (block.type === 'plot') {
                return _jsx(PlotImage, { spec: block.code, streaming: block.open }, index);
            }
            if (block.type === 'diagram') {
                return _jsx(DiagramView, { spec: block.code, streaming: block.open }, index);
            }
            if (block.type === 'table') {
                return (_jsx("div", { className: "markdown-table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsx("tr", { children: block.rows[0]?.map((cell, cellIndex) => (_jsx("th", { children: inline(cell, `t-${index}-${cellIndex}`) }, cellIndex))) }) }), _jsx("tbody", { children: block.rows.slice(1).map((row, rowIndex) => (_jsx("tr", { children: row.map((cell, cellIndex) => (_jsx("td", { children: inline(cell, `td-${index}-${rowIndex}-${cellIndex}`) }, cellIndex))) }, rowIndex))) })] }) }, index));
            }
            return null;
        }) }));
});
