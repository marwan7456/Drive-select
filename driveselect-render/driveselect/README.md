# DriveSelect – workshop service records

Coursework project. Staff sign in, add service records, and search/sort/filter them in a table.

**Live URL:** _add your Render address here_

## Run locally

Needs Node.js 18+. No dependencies, so no `npm install` is needed.

```bash
npm start      # http://localhost:3000
```

Sign in with `admin` / `nadeen`. The first start creates `data/records.json` with 10 demo records.

## Layout

| Part | Files |
|---|---|
| Front end | `public/index.html`, `public/app.js`, `public/style.css`, `public/img/` |
| Back end + storage | `server.js`, `data/records.json` |
| Deploy | `render.yaml`, `package.json` |

## Deploy to Render

1. Push this folder to GitHub so `package.json`, `server.js` and `public/` are at the **top level** of the repo.
2. On render.com: **New → Web Service** (not "Static Site"), pick the repo, and set:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `node server.js`
   - Health check path: `/api/health`
   (Or use **New → Blueprint**, which reads `render.yaml`.)
3. Deploy and open the `https://....onrender.com` address.

On the free plan, saved records go back to the demo set when the service restarts or redeploys.
