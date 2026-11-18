# Hajeela website: rules for every session

Hania's standing rule (19 Nov 2026): **branch first, never straight to live.**

`main` is the live site (Vercel deploys it to hajeela-lofi.vercel.app). Every change, however small, goes like this:

1. Fetch the latest `main`, then create a new branch from it. Never commit to `main`.
2. Make one focused change on that branch.
3. Test it at 390px and 1440px wide (use the `tester` agent).
4. Push the branch. Vercel makes a preview link for it. Send Hania the preview link plus phone and desktop screenshots.
5. Merge into `main` only after Hania says yes to that change.

Never deploy, merge, publish or touch anything financial without Hania's yes.
