import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { handleChatHttp, handleStatusHttp } from './node-http'
import { handleSearchHttp, handleWebHttp } from './web'

export function mintNvidiaProxy(): Plugin {
  const install = (middlewares: Connect.Server, root: string) => {
    middlewares.use('/api/status', (req: IncomingMessage, res: ServerResponse) => {
      handleStatusHttp(req, res, root)
    })

    middlewares.use('/api/web', (req: IncomingMessage, res: ServerResponse) => {
      void handleWebHttp(req, res)
    })

    middlewares.use('/api/search', (req: IncomingMessage, res: ServerResponse) => {
      void handleSearchHttp(req, res)
    })

    middlewares.use('/api/chat', (req: IncomingMessage, res: ServerResponse) => {
      void handleChatHttp(req, res, root)
    })
  }

  return {
    name: 'mint-nvidia-proxy',
    configureServer(server) {
      install(server.middlewares, server.config.root)
    },
    configurePreviewServer(server) {
      install(server.middlewares, server.config.root)
    },
  }
}
