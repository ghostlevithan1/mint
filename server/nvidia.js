import { handleChatHttp, handleStatusHttp } from './node-http';
import { guardApi } from './limits';
import { handleSearchHttp, handleWebHttp } from './web';
export function mintNvidiaProxy() {
    const install = (middlewares, root) => {
        middlewares.use('/api/status', (req, res) => {
            handleStatusHttp(req, res, root);
        });
        middlewares.use('/api/web', (req, res) => {
            if (!guardApi(req, res, 'web'))
                return;
            void handleWebHttp(req, res);
        });
        middlewares.use('/api/search', (req, res) => {
            if (!guardApi(req, res, 'web'))
                return;
            void handleSearchHttp(req, res);
        });
        middlewares.use('/api/chat', (req, res) => {
            if (!guardApi(req, res, 'chat'))
                return;
            void handleChatHttp(req, res, root);
        });
    };
    return {
        name: 'mint-nvidia-proxy',
        configureServer(server) {
            install(server.middlewares, server.config.root);
        },
        configurePreviewServer(server) {
            install(server.middlewares, server.config.root);
        },
    };
}
