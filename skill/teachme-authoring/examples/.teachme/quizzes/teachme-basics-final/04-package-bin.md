How is the `teachme` command made available after installing this project?

## Options
- [x] Via the `bin.teachme` entry in `package.json`
- [ ] It's a global alias set up manually
- [ ] Via a `postinstall` script that copies files to `/usr/bin`

## Explanation
`package.json` declares `"bin": { "teachme": "bin/teachme.js" }`, which npm
links onto your `PATH` when installed globally or with `npm link`.
