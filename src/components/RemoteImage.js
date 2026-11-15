import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { ExternalLink, FileWarning } from 'lucide-react';
/**
 * A remote image referenced by a URL in a message. Renders lazily with no
 * referrer, and degrades to a plain link if the host is unreachable, blocks
 * hotlinking, or the URL dies.
 */
export function RemoteImage({ url, alt }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (_jsxs("a", { className: "remote-image-fallback", href: url, target: "_blank", rel: "noreferrer noopener", children: [_jsx(FileWarning, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: alt }), _jsx("small", { children: "Could not load image \u2014 open link" })] }));
    }
    return (_jsxs("figure", { className: "remote-image", children: [_jsx("a", { href: url, target: "_blank", rel: "noreferrer noopener", title: "Open original", children: _jsx("img", { src: url, alt: alt, loading: "lazy", decoding: "async", referrerPolicy: "no-referrer", onError: () => setFailed(true) }) }), _jsxs("figcaption", { children: [_jsx("span", { className: "remote-image-alt", title: alt, children: alt }), _jsxs("a", { href: url, target: "_blank", rel: "noreferrer noopener", children: ["Open original", _jsx(ExternalLink, { size: 11, "aria-hidden": "true" })] })] })] }));
}
