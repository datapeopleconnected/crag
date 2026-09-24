# Security policy

## Supported versions

crag is pre-1.0, so security fixes go into the next release only. Upgrade to the latest version on
[npm](https://www.npmjs.com/package/@buttress/crag) to get them.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Anything older | No        |

## Reporting a vulnerability

Please don't report security issues in public issues, pull requests or discussions.

Report them privately through GitHub instead:

1. Open the repository's [Security tab](https://github.com/datapeopleconnected/crag/security).
2. Choose **Report a vulnerability**.
3. Fill in the form. GitHub shares the report only with the maintainers.

Include as much of the following as you can:

- the version of crag, and of Buttress if it's relevant;
- what an attacker could do, and what they'd need to do it;
- steps to reproduce, or a proof of concept;
- any fix or mitigation you'd suggest.

## What happens next

- We'll acknowledge your report within 5 working days.
- We'll confirm whether it's a vulnerability, and keep you updated while we work on a fix.
- Once a fix is released, we'll publish a security advisory and credit you, unless you'd rather not be named.

Please give us a reasonable chance to release a fix before you disclose the issue publicly.

## Scope

This policy covers the code in this repository: the `@buttress/crag` package, and the scripts and Docker setup used to
test it.

crag runs in the browser and sends your app's token with its requests, so anything that leaks the token, sends
requests or realtime subscriptions to the wrong place, or lets one client's data reach another is in scope.

Vulnerabilities in the Buttress server belong to [buttress-js](https://github.com/datapeopleconnected/buttress-js).
Vulnerabilities in a dependency should go to that project first. Tell us too if crag's use of it makes things worse.
