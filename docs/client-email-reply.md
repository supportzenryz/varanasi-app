Subject: Re: Varanasi website handover — where we've got to, and the plan from here

Hello,

Thanks for this — it's a helpful list to work from, and I'll go through each point below. Short version first: yes, we have enough from ZPos to be working, the build is already well underway, and I'd like to get a review call in the diary once you've read this.

**Where we are with ZPos**

We have both branches' page content, media libraries and the drinks menu PDF, which is enough to build against. Three things are still outstanding on their side and I'd like your help chasing them, since they're likely to respond faster to you than to us: a full database export (so we're not rebuilding anything by hand that doesn't need rebuilding), the DNS zone file, and confirmation of what happens to the existing Stripe account and the 4,800+ booking enquiries currently sitting in their system. None of these block us starting — they matter closer to launch.

**The process, and when you'll see it**

We're building one new site to replace both the Birmingham and Leicester sites, with a proper admin area behind it so your team can make changes yourselves without coming back to us for every wording or price change. Roughly:

- *Now – build*: menus, private dining, galleries, branch content, and the admin portal
- *Internal testing*: we check it ourselves against a checklist before you see anything
- *Your review*: we put it on a private staging link — nothing public — and you and your team go through it properly. This is the point in the process for the "full review and test before it goes live" you asked for, and we'd rather find issues here than after launch
- *Fixes, then launch*: we lower the DNS TTL a few days ahead so the switch itself is quick, and we do the cutover at a time that suits you, monitoring straight after

I'll send over actual dates once we've spoken, since a couple of your points below (particularly reservations and vouchers) affect the timeline.

**Your points, one by one**

*Reservations.* This is a new build, not a migration — the current site only has a booking enquiry form, not a real reservation system, so there's no availability checking, deposit handling or blocked-dates logic to carry over. We're building this properly: branch-aware booking, availability, blocked dates (already working — a manager can close a date or a single private room from the admin portal), and Stripe for deposits. This is the one area where I want to talk through timing with you directly, because a fully custom booking engine with live Stripe payments takes longer to test safely than a shorter build — I'd rather agree a realistic date with you than rush the part that takes your customers' money.

*Gift vouchers.* Same situation — nothing exists to migrate, so this is a new build: values, sender/recipient details, personalised messages, expiry, redemption tracking, and Stripe for the purchase itself. Also worth flagging: the outgoing vendor has confirmed no record of past voucher sales exists anywhere, which means we can't currently tell you how much unredeemed voucher value the business is carrying. Worth asking ZPos directly before that data disappears.

*Private dining rooms.* Found and fixed already. The live Leicester site was showing Birmingham's eight rooms instead of Leicester's own two, and Birmingham's own page undercounted its rooms. Every room, on both sites, now has its correct name, photo, capacity, deposit and hire charge, taken from your own published pages rather than guessed — and it's all editable from the admin portal, photo included.

*Birmingham & Leicester content.* Kept properly separate throughout — each branch has its own address, phone, hours, hero image, gallery and private dining, all pulled from its own record in the database, not shared. One thing I want to flag rather than assume: your food and drinks menus are genuinely the same at both branches on the current site (same dishes, same drinks list, same prices) — if that's intentional because it's one kitchen, no action needed; if you'd like them to diverge, that's a straightforward change once the admin portal is in your hands.

*Menus.* Done, and this is the big win of the new build: every dish, price, drink and set menu is stored as editable content, not code. A manager can log in, change a price or hide a dish, and it's live immediately — no developer, no ticket, no wait.

*Mobile experience.* Being built mobile-first throughout, not adapted afterwards — the current site has real mobile problems (menu, navigation) that we're not carrying forward.

*SEO & redirects.* We've captured a full map of your existing URLs and their current search rankings won't reset — we'll redirect every one of them to its new equivalent at launch, so nothing you rank for today disappears.

*Customer data & marketing.* Table reservations, contact enquiries and newsletter sign-ups will all be captured directly into the new database, viewable from the admin portal, rather than only arriving as emails the way they do today. We'll also bring across the 4,800+ existing booking enquiries from ZPos, filtered to only the ones who actually opted in to marketing — worth a quick word with your data protection contact to confirm that's the approach you want.

*Website management.* This is really the headline of the whole project. You'll have a proper admin portal, live already for menus and private dining, with reservations and blocked dates just added — your team can log in and change wording, prices, photos and room details yourselves, any time, with no developer involved. Gift vouchers and a few smaller admin screens (gallery, general enquiries) are still to come.

*Testing before launch.* Absolutely — that's what the staging review stage above is for. Reservations, vouchers, every form, every link, mobile display, both venues — nothing goes live until your team has been through it and signed it off.

*Domain / DNS.* Good to know ZPos will cooperate on this. We'll come to you with the exact DNS changes needed a few days before the agreed launch date, once staging is signed off — that keeps the cutover itself down to minutes, not hours.

**On making the switch seamless**

Agreed, and that's exactly how we're planning it — old and new can run side by side right up to the moment we switch DNS, so there's no gap where reservations or vouchers stop working.

**What I need from you**

A few decisions will shape the reservations and vouchers timeline in particular, so I'd like to get 30 minutes in the diary — happy to bring the team, as you offered. Ahead of that, if you can chase ZPos for the database export, DNS zone and Stripe/voucher-history confirmation, that would help keep things moving on their side while we carry on building.

I'll follow up with some call times shortly.

Best regards,
Sathish
Zenryz
