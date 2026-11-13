import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { handleChatHttp, handleStatusHttp } from './node-http'
import { guardApi } from './limits'
import { handlePlotHttp } from './plot-http'
import { handleSearchHttp, handleWebHttp } from './web'

export function mintNvidiaProxy(): Plugin {
  const install = (middlewares: Connect.Server, root: string) => {
    middlewares.use('/api/status', (req: IncomingMessage, res: ServerResponse) => {
      handleStatusHttp(req, res, root)
    })

    middlewares.use('/api/plot', (req: IncomingMessage, res: ServerResponse) => {
      if (!guardApi(req, res, 'plot')) return
      void handlePlotHttp(req, res)
    })

    middlewares.use('/api/web', (req: IncomingMessage, res: ServerResponse) => {
      if (!guardApi(req, res, 'web')) return
      void handleWebHttp(req, res)
    })

    middlewares.use('/api/search', (req: IncomingMessage, res: ServerResponse) => {
      if (!guardApi(req, res, 'web')) return
      void handleSearchHttp(req, res)
    })

    middlewares.use('/api/chat', (req: IncomingMessage, res: ServerResponse) => {
      if (!guardApi(req, res, 'chat')) return
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
