# KPI Dashboard — Plug A Pro Go-To-Market

> Track weekly (every Monday) and at month-end.
> Tool: Google Sheets

---

## Weekly Snapshot Tab

```
Week | Start Date | Platform | Impressions | Engagements | Eng Rate % | Followers | WhatsApp Convos | Demos Booked
```

Formula: `Eng Rate = Engagements/Impressions*100`

| Metric | Week 1–4 | Week 5–8 | Week 9–12 |
|---|---|---|---|
| Facebook reach | 500 | 2,000 | 5,000 |
| Instagram reach | — | 1,000 | 3,000 |
| Facebook page followers | 20/week | 50/week | 100/week |
| Instagram followers | — | 30/week | 60/week |
| WhatsApp conversations | 5 | 15 | 30 |
| Demo calls booked | 2 | 5 | 10 |
| Lead magnet downloads | 5 | 20 | 40 |

---

## Monthly Funnel Tab

```
Month | Reach | Clicks | WhatsApp Convos | Lead Magnets | Demos | Customers | MRR (R)
```

Formulas:
- Click rate: `=Clicks/Reach*100`
- Conversation rate: `=Convos/Clicks*100`
- Demo rate: `=Demos/Convos*100`
- Close rate: `=Customers/Demos*100`

| Metric | Month 1 | Month 2 | Month 3 |
|---|---|---|---|
| WhatsApp conversations | 30 | 80 | 150 |
| Lead magnet downloads | 20 | 60 | 120 |
| Demo calls | 10 | 25 | 40 |
| New paying customers | 2 | 8 | 12 |
| MRR added (R) | R3,000 | R12,000 | R20,000 |
| Demo-to-close rate | 20% | 25% | 30% |

---

## Paid Media Tab (Month 2+)

```
Campaign | Spend (R) | Impressions | Clicks | Convos | Lead Magnets | Demos | Customers | CPL (R) | CPD (R) | CAC (R)
```

- CPL: `=Spend/Convos`
- CPD: `=Spend/Demos`
- CAC: `=Total_spend/Customers`

**Kill rule:** CPL > R300 after R500 spend → pause and test new creative.

---

## GA4 Events (fired automatically from marketing site)

| Event | Fired when | Key params |
|---|---|---|
| `cta_click` | CTA button clicked | label, location, audience |
| `whatsapp_click` | WhatsApp link opened | source |
| `lead_magnet_download` | LeadMagnetForm submitted | magnet, source |
| `section_view` | Section enters viewport | section_name |
| `scroll_depth` | 25/50/75/100% reached | depth |
