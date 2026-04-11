# Lead Magnet 3: SA Service Business Cash Flow Tracker

> Delivery: Google Sheets link via WhatsApp DM
> Trigger: TRACKER
> Build once, share as "anyone with link can view" — they copy to their Drive

## Delivery Message
> Hi [Name] 👋 Here's your free Plug A Pro Cash Flow Tracker — a Google Sheets template built for SA service businesses.
>
> 👉 Click to copy: [Google Sheets link]
>
> Open → File → Make a Copy → save to your Drive.

---

## Sheet Structure

### Tab 1: Jobs Log
| Column | Field | Notes |
|---|---|---|
| A | Date | Job date |
| B | Customer Name | |
| C | Contact Number | |
| D | Job Type | Dropdown: plumbing/electrical/appliance/other |
| E | Technician | Name |
| F | Quoted Amount (R) | |
| G | Invoiced Amount (R) | |
| H | Payment Status | Dropdown: Unpaid/Partial/Paid |
| I | Payment Date | |
| J | Days Outstanding | `=IF(H2="Paid","",TODAY()-A2)` |
| K | Notes | |

### Tab 2: Dashboard (auto-calculated)
| Metric | Formula |
|---|---|
| Revenue this month (Paid) | `=SUMIFS(Jobs!G:G,Jobs!A:A,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),Jobs!H:H,"Paid")` |
| Revenue outstanding | `=SUMIFS(Jobs!G:G,Jobs!H:H,"Unpaid")` |
| Invoices unpaid > 14 days | `=COUNTIFS(Jobs!J:J,">"&14,Jobs!H:H,"Unpaid")` |
| Jobs this month | `=COUNTIFS(Jobs!A:A,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))` |

### Tab 3: Outstanding Invoices
Auto-filtered view: Payment Status = "Unpaid", sorted by Days Outstanding descending.

---

## Follow-Up Message
> The dashboard will show your outstanding invoices automatically as you add jobs. Most service businesses who fill this in for a week are shocked at how much is sitting unpaid. Plug A Pro automates the follow-up on those — no manual chasing. Reply DEMO to see how.
