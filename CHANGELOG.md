# Changelog

## [0.4.0](https://github.com/viliuskerpauskas/troba/compare/v0.3.0...v0.4.0) (2026-10-26)


### Features

* content security policy for scripts and HSTS ([#96](https://github.com/viliuskerpauskas/troba/issues/96)) ([8497315](https://github.com/viliuskerpauskas/troba/commit/849731576030a4fd0472149d147ac7551c5f860e)), closes [#43](https://github.com/viliuskerpauskas/troba/issues/43)
* **identity:** delete expired sessions ([#93](https://github.com/viliuskerpauskas/troba/issues/93)) ([7d4186b](https://github.com/viliuskerpauskas/troba/commit/7d4186b1063d2908cff15daf60e28e30b643dd53)), closes [#44](https://github.com/viliuskerpauskas/troba/issues/44)
* **money:** auto-categorization rules ([#87](https://github.com/viliuskerpauskas/troba/issues/87)) ([b64a889](https://github.com/viliuskerpauskas/troba/commit/b64a8892c75717468aa3d7836dd4bd974241dc4b)), closes [#22](https://github.com/viliuskerpauskas/troba/issues/22)
* **money:** filter, search and page the transaction list ([#91](https://github.com/viliuskerpauskas/troba/issues/91)) ([53eeef0](https://github.com/viliuskerpauskas/troba/commit/53eeef0841e71662e950d773839714b1dd17c47e)), closes [#24](https://github.com/viliuskerpauskas/troba/issues/24)
* **money:** import UI with column mapping ([#92](https://github.com/viliuskerpauskas/troba/issues/92)) ([24a1abd](https://github.com/viliuskerpauskas/troba/commit/24a1abd10b4e4601eeee313ea9972e34d7eb3f1e)), closes [#21](https://github.com/viliuskerpauskas/troba/issues/21)
* **money:** receipt attachments ([#94](https://github.com/viliuskerpauskas/troba/issues/94)) ([fc2d9df](https://github.com/viliuskerpauskas/troba/commit/fc2d9df64b36483e4d208b50d3bf4f53270eb7a6)), closes [#25](https://github.com/viliuskerpauskas/troba/issues/25)


### Bug Fixes

* deflake the invites revoke check and sign-in waits ([#99](https://github.com/viliuskerpauskas/troba/issues/99)) ([04da09b](https://github.com/viliuskerpauskas/troba/commit/04da09b92b99958549a73d64f714988be1b88715)), closes [#58](https://github.com/viliuskerpauskas/troba/issues/58)
* **identity:** accept only a bare IP address from X-Forwarded-For ([#107](https://github.com/viliuskerpauskas/troba/issues/107)) ([319689d](https://github.com/viliuskerpauskas/troba/commit/319689de3406a58961a3e7badb349e5c6cb7833c)), closes [#78](https://github.com/viliuskerpauskas/troba/issues/78)
* **identity:** admin users and invites fit phone screens ([#113](https://github.com/viliuskerpauskas/troba/issues/113)) ([dfba263](https://github.com/viliuskerpauskas/troba/commit/dfba263f35779f81e30de12d5f55706c99af8ec5)), closes [#105](https://github.com/viliuskerpauskas/troba/issues/105)
* **identity:** one-time link inputs fit phone screens ([#106](https://github.com/viliuskerpauskas/troba/issues/106)) ([0a095e2](https://github.com/viliuskerpauskas/troba/commit/0a095e2a293392b8894de3a09e8085f1442b8879)), closes [#62](https://github.com/viliuskerpauskas/troba/issues/62)

## [0.3.0](https://github.com/viliuskerpauskas/troba/compare/v0.2.0...v0.3.0) (2026-10-21)


### Features

* **identity:** count IPv6 sign-in attempts per /64 ([#79](https://github.com/viliuskerpauskas/troba/issues/79)) ([7ea6217](https://github.com/viliuskerpauskas/troba/commit/7ea62172e313306569a716cd4818ca4eb37fa068)), closes [#52](https://github.com/viliuskerpauskas/troba/issues/52)
* **money:** import preview and atomic commit ([#82](https://github.com/viliuskerpauskas/troba/issues/82)) ([2d386f0](https://github.com/viliuskerpauskas/troba/commit/2d386f00352acc872206af53c9695e7b48153b8f)), closes [#20](https://github.com/viliuskerpauskas/troba/issues/20)
* **money:** monthly spending view ([#81](https://github.com/viliuskerpauskas/troba/issues/81)) ([8388d03](https://github.com/viliuskerpauskas/troba/commit/8388d03e260a826e0ad942521d314ab6bd2a73a1)), closes [#23](https://github.com/viliuskerpauskas/troba/issues/23)


### Bug Fixes

* make the health route unit test deterministic ([#84](https://github.com/viliuskerpauskas/troba/issues/84)) ([0e5b804](https://github.com/viliuskerpauskas/troba/commit/0e5b80470bc99afa74e42c40cb63aace1bf9d1c5)), closes [#46](https://github.com/viliuskerpauskas/troba/issues/46)
* **money:** keep the Transfers category from being deleted ([#86](https://github.com/viliuskerpauskas/troba/issues/86)) ([5879b22](https://github.com/viliuskerpauskas/troba/commit/5879b2294ab918d31aa99e67fd29f93c85d0ece8)), closes [#74](https://github.com/viliuskerpauskas/troba/issues/74)

## [0.2.0](https://github.com/viliuskerpauskas/troba/compare/v0.1.0...v0.2.0) (2026-10-20)


### Features

* **money:** add, rename and delete categories ([#75](https://github.com/viliuskerpauskas/troba/issues/75)) ([637e273](https://github.com/viliuskerpauskas/troba/commit/637e27377fe648e1fa6ac49514329426824618cd)), closes [#18](https://github.com/viliuskerpauskas/troba/issues/18)
* **money:** CSV decoding and profile row parsing ([#76](https://github.com/viliuskerpauskas/troba/issues/76)) ([34bb7cb](https://github.com/viliuskerpauskas/troba/commit/34bb7cb559893687e9007f6bd1724837247c5c2e)), closes [#19](https://github.com/viliuskerpauskas/troba/issues/19)

## 0.1.0 (2026-10-20)


### Features

* **identity:** account settings and sessions ([#48](https://github.com/viliuskerpauskas/troba/issues/48)) ([c9cbaf7](https://github.com/viliuskerpauskas/troba/commit/c9cbaf7bf42255462a2f365022ce5af72a432fa3))
* **identity:** admin user management and password reset links ([#63](https://github.com/viliuskerpauskas/troba/issues/63)) ([8c74585](https://github.com/viliuskerpauskas/troba/commit/8c7458591ad52ad8469e14dd2a985d2eed2d1e3d))
* **identity:** Better Auth, sign-in/out and admin bootstrap CLI ([#42](https://github.com/viliuskerpauskas/troba/issues/42)) ([1250d22](https://github.com/viliuskerpauskas/troba/commit/1250d221dca79f1d88742ed22c76342420899898))
* **identity:** delete account ([#57](https://github.com/viliuskerpauskas/troba/issues/57)) ([12ce09d](https://github.com/viliuskerpauskas/troba/commit/12ce09db451bfc11b9afa9d60e90f718a7d5f528))
* **identity:** invites and invite sign-up ([#49](https://github.com/viliuskerpauskas/troba/issues/49)) ([da222cf](https://github.com/viliuskerpauskas/troba/commit/da222cfb9c91e6c63936644493f58a14b9e507e7))
* **identity:** rate-limit sign-in and password checks ([#53](https://github.com/viliuskerpauskas/troba/issues/53)) ([2cb34c0](https://github.com/viliuskerpauskas/troba/commit/2cb34c0f1fef5da18a21d9567846695b66e48456))
* **money:** manual transactions and basic list ([#73](https://github.com/viliuskerpauskas/troba/issues/73)) ([f786b57](https://github.com/viliuskerpauskas/troba/commit/f786b576a80b8fe983205666c701ad57b35a05fc)), closes [#17](https://github.com/viliuskerpauskas/troba/issues/17)
* **money:** schema, defaults and financial accounts ([#70](https://github.com/viliuskerpauskas/troba/issues/70)) ([c4e5617](https://github.com/viliuskerpauskas/troba/commit/c4e5617f8b8c2441dc8829670f056fc88541e332)), closes [#16](https://github.com/viliuskerpauskas/troba/issues/16)
* Postgres, Drizzle migrations and health endpoint ([#31](https://github.com/viliuskerpauskas/troba/issues/31)) ([bd18fd9](https://github.com/viliuskerpauskas/troba/commit/bd18fd9e71b6ce681015c4a68ea9f9ffe406284a)), closes [#3](https://github.com/viliuskerpauskas/troba/issues/3)
* production container image with migrate step ([#34](https://github.com/viliuskerpauskas/troba/issues/34)) ([38c350e](https://github.com/viliuskerpauskas/troba/commit/38c350e81504fab5c9c69e36ca2a3bbb64dd92c1)), closes [#5](https://github.com/viliuskerpauskas/troba/issues/5)


### Bug Fixes

* **identity:** build the auth Cookie header from cookie entries ([#51](https://github.com/viliuskerpauskas/troba/issues/51)) ([02d5c18](https://github.com/viliuskerpauskas/troba/commit/02d5c18b0dc46ff61de4c5fe762ab85a09943c48))
