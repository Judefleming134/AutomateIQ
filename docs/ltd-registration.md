# Setting up the Limited company — details sheet

Everything CORE (and a formation agent) will ask for, in roughly the order
it's asked. Fill the blanks marked **[ ]** before you start and the form is a
ten-minute job. Kept in the repo so it survives — the earlier version was lost
because it only ever lived in a chat.

**File at:** [core.cro.ie](https://core.cro.ie) — Form A1 + Constitution, €50 online.
**Or hand this sheet to a formation agent** (~€200–300, done in a few days).

---

## 1. Company name

- Proposed name: **[ ]** (likely `AutomateIQ Ltd` / `AutomateIQ Limited`)
- Checked availability on the CRO name search: **[ ] yes / no**

> CRO rejects names too similar to an existing company, and generic/descriptive
> names. Have a second and third choice ready so a rejection doesn't cost you a
> week. `automateiq.ie` being yours does **not** reserve the company name.

## 2. Registered office & business address

- Registered office (real Irish address, no PO box): **[ ]**
- Business/trading address (if different): **[ ]**

> Public on the CRO register. If you don't want your home address listed, a
> registered-office service is ~€100–150/year and most formation agents bundle it.

## 3. Directors

- Director 1 full legal name: **Jude Fleming** — *confirm exact spelling as on passport*
- Date of birth: **[ ]**
- Residential address: **[ ]**
- Nationality: **[ ]**
- PPSN: **[ ]** *(mandatory — no PPSN means Form VIF for an IPN first)*
- Other directorships (Irish or foreign), if any: **[ ]**

> At least one director must be **EEA-resident** — fine as an Irish resident.
> A non-EEA-only board needs a ~€25k Section 137 bond instead.

## 4. Company secretary

- Secretary: **[ ]**

> **The catch:** with only ONE director you must appoint a **separate** company
> secretary — one person cannot be both. Options: a family member/partner who
> consents, a second director, or a corporate secretarial service (~€100–200/yr,
> usually bundled by formation agents). Decide this before you sit down to file.

## 5. Shares

- Total shares issued: **[ ]** *(commonly 100)*
- Nominal value each: **[ ]** *(commonly €1)*
- Shareholder(s) and split: **[ ]** *(e.g. Jude Fleming — 100 of 100)*

> Keep it simple at 100% while it's just you. If anyone joins later, ask the
> accountant about it *before* issuing shares — unpicking a split afterwards is
> the expensive kind of mistake.

## 6. Business activity

- Description: **[ ]** *(e.g. "Development and implementation of AI automation
  systems for small and medium businesses")*
- NACE code: **62.01 — Computer programming activities** *(confirm on the CORE list)*

## 7. Constitution

The LTD single-document constitution. The CORE flow offers a standard one; a
formation agent supplies it. No need to draft anything custom for a one-person
services company.

---

## After incorporation — the bits people miss

| # | Task | Where | Deadline |
|---|------|-------|----------|
| 1 | Register for **corporation tax** (and VAT/PAYE if relevant) — Form TR2 | Revenue **ROS** | Before trading |
| 2 | File **beneficial ownership** | **RBO** (rbo.gov.ie) | **Within 5 months** — penalties if missed |
| 3 | Open a **business bank account** | Revolut Business / bank | Once you have the cert of incorporation |
| 4 | Move **Stripe** to the company entity | Stripe dashboard | Before the first customer payment |
| 5 | Note the **annual return date (ARD)** — first return is 6 months after incorporation | CRO | Diary it — late filing = penalties + audit exposure |

## Ask the accountant (15 minutes, worth it before you file)

1. **VAT now or later?** Registering early means charging VAT to customers who
   may not be able to reclaim it; registering late has a threshold trap. Ask
   which applies to selling AI systems to small Irish businesses.
2. **Salary vs dividends** — how to pay yourself tax-efficiently in year one.
3. **Share structure** — 100% now, or leave room for a future partner/investor?
4. Whether the **sole director + separate secretary** setup they'd recommend is
   a person or a corporate secretary service.
5. What you can put through the company from the setup so far (domain, Vercel,
   Supabase, ElevenLabs, Resend, phone) and how far back it can be claimed.

---

*Not legal or tax advice — this is a preparation checklist. Confirm the €50 fee
and current requirements on cro.ie when you file.*
