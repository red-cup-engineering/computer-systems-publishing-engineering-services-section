# Project browser asset tree

`@red-cup-engineering/project-browser-asset-tree-service` projects a browser-safe source tree into static assets. It preserves the projection effect; HTTP listening and static-file delivery belong to `@red-cup-engineering/computer-web-server`. Browser inputs are JavaScript modules, so no server strips TypeScript at request time.
