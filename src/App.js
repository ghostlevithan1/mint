import { jsx as _jsx } from "react/jsx-runtime";
import { ChatApp } from './components/ChatApp';
export default function App() {
    return (_jsx("div", { className: "app", children: _jsx(ChatApp, {}) }));
}
