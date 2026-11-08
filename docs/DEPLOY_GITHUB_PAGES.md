# Deploying on GitHub Pages (step by step)

1. Create a repo on github.com (name it something plain, e.g. `snowglobe`; the name becomes part of the link).
2. In VS Code: open the folder `winterlight`, Source Control icon (left bar), "Initialize Repository", type a message, Commit, then "Publish Branch" and choose the repo. Make sure the branch is called `main`.
3. On GitHub: repo Settings, Pages, Build and deployment, Source: **GitHub Actions**.
4. Settings, Actions, General: allow actions.
5. Every push to `main` builds and publishes. Watch it in the Actions tab; when green, the link is `https://<your-username>.github.io/<repo-name>/`.
6. The build refuses to publish if any `TODO_OWNER` remains or if a source map is in the output (leak scan).

Notes: Pages cannot send the `noindex` header, so the page's `<meta name="robots">` is the only protection, and `robots.txt` is ignored in a project folder. Treat the link as readable by anyone who has it.
