# Changelog

## [2.0.1](https://github.com/zarmstrong/resumecms/compare/v2.0.0...v2.0.1) (2026-11-16)


### Bug Fixes

* **deps:** bump body-parser from 2.3.0 to 2.4.0 in /server ([#202](https://github.com/zarmstrong/resumecms/issues/202)) ([c85ada0](https://github.com/zarmstrong/resumecms/commit/c85ada08a5b12e6eaf8a75136e5c8e689c4a5db4))
* **deps:** bump ip-address from 10.7.0 to 10.7.6 in /server ([#204](https://github.com/zarmstrong/resumecms/issues/204)) ([47c8026](https://github.com/zarmstrong/resumecms/commit/47c8026b2c30edfcc315ae30258d79c69444cc14))
* **deps:** bump qs from 6.16.0 to 6.17.1 in /server ([#203](https://github.com/zarmstrong/resumecms/issues/203)) ([5d00240](https://github.com/zarmstrong/resumecms/commit/5d002408013c16ca109a35bf8a9dab5336c75ab9))

## [2.0.0](https://github.com/zarmstrong/resumecms/compare/v1.2.0...v2.0.0) (2026-11-16)


### ⚠ BREAKING CHANGES

* **auth:** the server now refuses to start unless RESUMECMS_SESSION_SECRET is set to at least 32 characters and isn't a known placeholder (the old compose default "please-change-this-session-secret", "dev-secret-change-me", the old .env.example value or "devsecret"). Generate one with `openssl rand -hex 32`. Changing it signs everyone out.

### Features

* show the app version in the editor's top bar ([#189](https://github.com/zarmstrong/resumecms/issues/189)) ([93fe585](https://github.com/zarmstrong/resumecms/commit/93fe585f0b91dc02bacd1558200127daeca9816f))


### Bug Fixes

* answer errors outside a handler as JSON, not Express's HTML ([#186](https://github.com/zarmstrong/resumecms/issues/186)) ([c59604c](https://github.com/zarmstrong/resumecms/commit/c59604c759e299ae8aec0e5c71b1e1d40fca98fb))
* **auth:** give the tab that changes the login a new session ([#198](https://github.com/zarmstrong/resumecms/issues/198)) ([11ec896](https://github.com/zarmstrong/resumecms/commit/11ec896ecf6a651e7e3c6477616a62e56c69127c))
* **auth:** keep the active 2FA factor until a new one is confirmed ([#188](https://github.com/zarmstrong/resumecms/issues/188)) ([17edb8e](https://github.com/zarmstrong/resumecms/commit/17edb8e0adaebdb2419e5d026d334c895f48c099))
* **auth:** make logins revocable with server-side sessions ([#192](https://github.com/zarmstrong/resumecms/issues/192)) ([041ddf8](https://github.com/zarmstrong/resumecms/commit/041ddf89c0fe1531beb453a0826d2f0a3bf8d13d))
* **auth:** refuse to start when the login captcha is misconfigured ([#185](https://github.com/zarmstrong/resumecms/issues/185)) ([5afb2e6](https://github.com/zarmstrong/resumecms/commit/5afb2e67c4709113fa0e21628fbea78ef809a9c7)), closes [#174](https://github.com/zarmstrong/resumecms/issues/174)
* **auth:** refuse to start without a real session secret ([#187](https://github.com/zarmstrong/resumecms/issues/187)) ([359382d](https://github.com/zarmstrong/resumecms/commit/359382d3c84faff47f1df2386b438e6016569735))
* **deps:** bump openai from 7.55.0 to 7.56.0 in /server ([#196](https://github.com/zarmstrong/resumecms/issues/196)) ([ff898c2](https://github.com/zarmstrong/resumecms/commit/ff898c29a7e1b896128a5bc6ae25a7595bcbbf8f))
* **deps:** move the Docker image and CI to Node 26 ([#200](https://github.com/zarmstrong/resumecms/issues/200)) ([d2eff81](https://github.com/zarmstrong/resumecms/commit/d2eff81b98ff6a6d5e57925e12541959cc5c3617))


### Performance

* lazy-load the editor so public visitors don't download it ([#195](https://github.com/zarmstrong/resumecms/issues/195)) ([2fa31bf](https://github.com/zarmstrong/resumecms/commit/2fa31bfc7d1699fcfdcf6cc25afe539ac42d5ec6))

## [1.2.0](https://github.com/zarmstrong/resumecms/compare/v1.1.1...v1.2.0) (2026-11-14)


### Features

* add eight more landing page presets ([#181](https://github.com/zarmstrong/resumecms/issues/181)) ([16a4d58](https://github.com/zarmstrong/resumecms/commit/16a4d58f86f65cf6ebf94cbea6e17bdfc97fa2dd))
* preview a landing preset full size before using it ([#183](https://github.com/zarmstrong/resumecms/issues/183)) ([8e3fec8](https://github.com/zarmstrong/resumecms/commit/8e3fec8f07e997c1d28b381d2a0ea0545d468644))
* start the landing page from a preset by profession ([#130](https://github.com/zarmstrong/resumecms/issues/130)) ([#170](https://github.com/zarmstrong/resumecms/issues/170)) ([026c13d](https://github.com/zarmstrong/resumecms/commit/026c13d8c81d0371129602c8ce5fbce0ea0348ff))


### Bug Fixes

* say what the split column holds in the software preset ([#182](https://github.com/zarmstrong/resumecms/issues/182)) ([10cb304](https://github.com/zarmstrong/resumecms/commit/10cb3041ee94c7149ea167f7c2c78c31d8733f3d))
* write the hospitality preset's titles in the first person ([#184](https://github.com/zarmstrong/resumecms/issues/184)) ([eecd51c](https://github.com/zarmstrong/resumecms/commit/eecd51ca19e9d771573e85d3e2702e8471d10423))

## [1.1.1](https://github.com/zarmstrong/resumecms/compare/v1.1.0...v1.1.1) (2026-11-12)


### Bug Fixes

* **deps:** bump the client group with 2 updates ([#168](https://github.com/zarmstrong/resumecms/issues/168)) ([ba3a14b](https://github.com/zarmstrong/resumecms/commit/ba3a14b00d27659a873c262334b3c26ff81df63d))
* **deps:** bump the server group with 5 updates ([#167](https://github.com/zarmstrong/resumecms/issues/167)) ([09709d7](https://github.com/zarmstrong/resumecms/commit/09709d7bbd2f8c56fb8b6d87a065e383deedbe32))

## [1.1.0](https://github.com/zarmstrong/resumecms/compare/v1.0.0...v1.1.0) (2026-11-12)


### Features

* add the Card landing template, a digital business card ([#130](https://github.com/zarmstrong/resumecms/issues/130)) ([#157](https://github.com/zarmstrong/resumecms/issues/157)) ([dd981bb](https://github.com/zarmstrong/resumecms/commit/dd981bb253307c3df329a7b8369324fc62a58dcb))
* add the Gallery landing template, for work shown in pictures ([#130](https://github.com/zarmstrong/resumecms/issues/130)) ([#162](https://github.com/zarmstrong/resumecms/issues/162)) ([b211721](https://github.com/zarmstrong/resumecms/commit/b211721f81bd7fd032b442920f2bbff00b8355ce))

## 1.0.0 (2026-11-11)


### Features

* publish releases and Docker Hub images with release-please ([#163](https://github.com/zarmstrong/resumecms/issues/163)) ([22eacf8](https://github.com/zarmstrong/resumecms/commit/22eacf85d95bac7e6939433b49ad145146f55cd9))
