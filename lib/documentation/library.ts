/**
 * Starter documentation library. These are seeded into `doc_documents` by
 * the admin "Load starter library" action (idempotent by slug) and are then
 * fully editable in the admin console — the content is DATA, not hardcoded
 * into any render path. Adding, editing or removing documents needs no code
 * change.
 *
 * Categories order the Documentation Centre; sortOrder orders within a
 * category. All are seeded published + global (visible to every active
 * customer) as a standard client library; admins can un-publish, make
 * targeted, or assign to groups.
 */
export type LibraryDoc = {
  slug: string;
  title: string;
  category: string;
  icon: string;
  summary: string;
  sortOrder: number;
  content: string;
};

export const DOC_CATEGORY_ORDER = [
  "Getting Started",
  "Your Project",
  "Using AutomateIQ",
  "Support & Operations",
  "Trust & Compliance",
];

export const DOCUMENTATION_LIBRARY: LibraryDoc[] = [
  {
    slug: "welcome-pack",
    title: "Welcome Pack",
    category: "Getting Started",
    icon: "sparkles",
    summary: "Everything you need to know to get started with AutomateIQ.",
    sortOrder: 10,
    content: `# Welcome to AutomateIQ

Welcome aboard. You've just given your business a team of AI employees that work around the clock — capturing leads, sending review requests, quoting jobs, writing content and keeping your customers organised. This pack is your starting point.

> [!TIP] Read this first, then work through the **Client Onboarding Guide**. The two together take about 20 minutes and set you up for everything that follows.

## What AutomateIQ does for you

AutomateIQ is a single platform where specialist AI agents handle the repetitive work that eats your week. You talk to one **AI Assistant**; it coordinates the rest.

| Agent | What it does for you |
| --- | --- |
| AI Assistant | Your control centre — ask it anything, and it runs the other agents |
| Review Agent | Automates Google review requests and reminders |
| Website Agent | A hosted page that captures enquiries straight into the platform |
| Instant Quote Agent | Turns a job description into a branded quote your customer accepts online |
| Content Agent | Plans and writes whole marketing campaigns in your voice |
| CRM Agent | Every contact, lead and customer in one pipeline |
| Speed-to-Lead Agent | Replies to new leads within 60 seconds, day or night |

## Your first week

- [ ] Complete the **Client Onboarding Guide**
- [ ] Fill in your **Business Knowledge** under Settings (this powers every agent)
- [ ] Send your first review request
- [ ] Ask the AI Assistant: *"How is my business doing right now?"*
- [ ] Book your onboarding call if you haven't already

## Who to contact

| Need | Contact |
| --- | --- |
| Anything at all | hello@automateiq.ie |
| Something urgent | See the **Support Guide** for response times |

> [!NOTE] Your dedicated onboarding specialist will reach out within one business day of go-live. You're never on your own.

We're genuinely glad you're here. Let's get your business running itself.`,
  },
  {
    slug: "client-onboarding-guide",
    title: "Client Onboarding Guide",
    category: "Getting Started",
    icon: "rocket",
    summary: "A step-by-step path from first login to first results.",
    sortOrder: 20,
    content: `# Client Onboarding Guide

This guide takes you from your first login to seeing real results, in order. Work through it top to bottom — each step builds on the last.

## Stage 1 — Set the foundation

Everything the AI does draws on what your business knows. Set this once and every agent gets smarter.

- [ ] Go to **Settings → Business knowledge** and describe your business: services, prices, hours, service area, and anything customers commonly ask
- [ ] Set your **brand voice / tone**
- [ ] Add your logo and, if you use the Review Agent, your Google review link

> [!IMPORTANT] The quality of everything the AI produces is directly tied to the detail here. Ten minutes now saves hours later.

## Stage 2 — Switch on your agents

Your enabled agents appear on your dashboard and in the Products hub. For each one:

1. Open the agent from your dashboard
2. Complete its short setup (e.g. the Instant Quote Agent needs your price guide)
3. Run it once to see it work

## Stage 3 — First results

| Goal | Do this |
| --- | --- |
| A review | Send a review request from the Review Agent |
| A quote | Create and send a quote from the Instant Quote Agent |
| A campaign | Launch a campaign in the Content Agent |
| A tidy pipeline | Click "Import from agents" in the CRM |

## Stage 4 — Make it a habit

- [ ] Bookmark your dashboard on your phone's home screen
- [ ] Each morning, open the AI Assistant and ask what needs attention
- [ ] Review your Analytics weekly

## Onboarding checklist

- [ ] Business knowledge completed
- [ ] Brand voice set
- [ ] Each enabled agent set up and run once
- [ ] First review request / quote / campaign sent
- [ ] Team members invited (see **User Guide**)

Once every box is ticked, you're fully live. Your onboarding specialist will confirm and hand you over to ongoing support.`,
  },
  {
    slug: "discovery-questionnaire",
    title: "Discovery Questionnaire",
    category: "Getting Started",
    icon: "clipboard",
    summary: "Tell us about your business so we can tailor the platform to you.",
    sortOrder: 30,
    content: `# Discovery Questionnaire

The more we understand your business, the better we can configure AutomateIQ for it. Please work through these questions — your onboarding specialist will use your answers to tailor your setup.

## About your business

- What does your business do, in one sentence?
- What area(s) do you serve?
- What are your opening hours, including any emergency or out-of-hours service?
- How many people are in the team?

## Your customers

- Who is your typical customer?
- How do customers usually find and contact you today?
- What are the three questions customers ask you most?

## Your services & pricing

- What are your main services?
- How do you price them (fixed, hourly, per job, quoted)?
- Are there call-out fees, minimum charges or materials to account for?

## Your goals

| Priority | Rank 1–5 |
| --- | --- |
| More Google reviews | |
| Faster quoting | |
| Capturing more leads | |
| Saving admin time | |
| Marketing / content | |

## Your current tools

- What software do you use today (CRM, calendar, accounting, website)?
- Is there anything you'd want AutomateIQ to work alongside?

## Anything else

> [!NOTE] Is there anything specific to your business we should know — busy seasons, compliance requirements, a particular tone you want, jobs you *don't* take? Tell us here.

Return this to your onboarding specialist, or simply tell the AI Assistant and it will capture the essentials into your Business Knowledge.`,
  },
  {
    slug: "statement-of-work",
    title: "Statement of Work",
    category: "Your Project",
    icon: "file-text",
    summary: "The scope, deliverables and responsibilities for your engagement.",
    sortOrder: 10,
    content: `# Statement of Work

This document sets out what AutomateIQ will deliver, what's expected of each party, and how success is measured. It is tailored per client; the version assigned to you reflects your specific agreement.

## 1. Scope

AutomateIQ will provision and configure the following for your business:

- The AutomateIQ platform account with role-based access
- The AI agents included in your plan
- Onboarding, configuration and initial training
- Ongoing support and maintenance per your plan tier

## 2. Deliverables

| Deliverable | Owner | Target |
| --- | --- | --- |
| Account provisioned | AutomateIQ | Day 0 |
| Business knowledge configured | Shared | Week 1 |
| Agents live and tested | AutomateIQ | Week 1–2 |
| Team trained | AutomateIQ | Week 2 |
| Go-live sign-off | Shared | Week 2 |

## 3. Responsibilities

**AutomateIQ will:**
- Configure and test each agent
- Provide onboarding and training
- Maintain the platform, security and uptime

**You will:**
- Provide accurate business information and pricing
- Nominate a primary contact
- Review and approve go-live

## 4. Out of scope

Anything not listed above is out of scope unless agreed via a **Change Request Form**. Bespoke integrations and custom modules are handled as separate engagements.

## 5. Acceptance

> [!IMPORTANT] Go-live is considered accepted once your nominated contact confirms each agent is configured and working as agreed. Any issues raised within the acceptance window are resolved at no cost.

## 6. Commercials

Commercial terms (fees, term, payment schedule) are set out in your order form and are incorporated into this Statement of Work by reference.`,
  },
  {
    slug: "technical-requirements-checklist",
    title: "Technical Requirements Checklist",
    category: "Your Project",
    icon: "check-square",
    summary: "What we need from you to go live smoothly.",
    sortOrder: 20,
    content: `# Technical Requirements Checklist

A short, practical checklist of what we need to get you live. Most clients complete this in under an hour.

## Access & accounts

- [ ] A primary email address for your account owner
- [ ] Google Business Profile access (for the Review Agent's review link)
- [ ] Your logo file (PNG or SVG, transparent background preferred)

## Business information

- [ ] Services and descriptions
- [ ] Pricing / rate card (for the Instant Quote Agent)
- [ ] Opening hours and service area
- [ ] Contact details to display to customers

## Email deliverability

For emails to send reliably from your business identity:

- [ ] Confirm the from-address you'd like to use
- [ ] If using your own domain, be ready to add DNS records we provide

> [!NOTE] Until domain verification is complete, emails send from a verified AutomateIQ address so nothing is blocked while DNS propagates.

## Optional integrations

| Integration | Needed for |
| --- | --- |
| Custom domain | Branded website page / email |
| Existing website | Embedding lead capture |

## Sign-off

- [ ] All required items above complete
- [ ] Primary contact confirmed
- [ ] Ready for configuration

Once this checklist is complete, hand it to your onboarding specialist and we'll begin configuration.`,
  },
  {
    slug: "project-timeline",
    title: "Project Timeline",
    category: "Your Project",
    icon: "calendar",
    summary: "What happens when, from kickoff to go-live.",
    sortOrder: 30,
    content: `# Project Timeline

A typical AutomateIQ onboarding runs over two weeks. Yours may be faster depending on how quickly information is provided.

## Phases

| Phase | When | What happens |
| --- | --- | --- |
| Kickoff | Day 0 | Account provisioned, welcome pack sent, discovery started |
| Configuration | Days 1–5 | Business knowledge loaded, agents configured |
| Testing | Days 6–8 | Each agent tested end-to-end with real examples |
| Training | Days 9–10 | Your team is trained; questions answered |
| Go-live | Day 10–14 | Sign-off, full launch, handover to support |

## Visual overview

\`\`\`
Week 1                         Week 2
[ Kickoff ]--[ Configure ]--[ Test ]--[ Train ]--[ Go-live ]
     ^                                              ^
   you provide info                          you sign off
\`\`\`

## Milestones & your part

- [ ] **Kickoff** — complete the Discovery Questionnaire
- [ ] **Configuration** — provide pricing, logo, review link
- [ ] **Testing** — review test outputs and give feedback
- [ ] **Training** — attend the training session
- [ ] **Go-live** — confirm sign-off

> [!TIP] The single biggest factor in a fast go-live is how quickly your business information and pricing are provided. Prioritise the Discovery Questionnaire.`,
  },
  {
    slug: "change-request-form",
    title: "Change Request Form",
    category: "Your Project",
    icon: "edit",
    summary: "How to request changes to scope or configuration.",
    sortOrder: 40,
    content: `# Change Request Form

Need something changed, added or configured differently? This is how to request it so nothing gets lost.

## When to raise a change request

- New agent or module
- A change to how an existing agent is configured beyond normal settings
- A new integration
- Anything outside the agreed Statement of Work

> [!NOTE] Day-to-day settings you can change yourself (prices, templates, knowledge) don't need a change request — just edit them in the dashboard.

## What to include

| Field | Detail |
| --- | --- |
| Requested by | Your name |
| Date | Today's date |
| What you want | A clear description of the change |
| Why | The business reason / outcome |
| Priority | Low / Medium / High |
| Deadline | Any date it's needed by |

## The process

1. Submit the request to hello@automateiq.ie (or ask the AI Assistant to note it)
2. We assess scope, effort and any cost, and respond with options
3. You approve
4. We schedule and deliver
5. You confirm it's done

> [!IMPORTANT] Changes that fall within your plan are delivered at no extra cost. Anything that affects commercials will always be quoted and approved by you before any work begins.`,
  },
  {
    slug: "handover-guide",
    title: "Handover Guide",
    category: "Your Project",
    icon: "handshake",
    summary: "Moving from onboarding into day-to-day running.",
    sortOrder: 50,
    content: `# Handover Guide

At the end of onboarding, you're handed over from your onboarding specialist to ongoing support. This guide confirms everything is in place.

## Handover checklist

- [ ] All contracted agents are live and tested
- [ ] Business knowledge and pricing are complete
- [ ] Your team has access and has been trained
- [ ] You know how to reach support
- [ ] You've received this documentation library

## What you own now

You are fully in control of:

- Your business knowledge and brand voice
- Each agent's settings, templates and pricing
- Your team and their access
- Your content, quotes, contacts and reviews

## What we continue to own

- Platform uptime, security and maintenance
- Model and feature upgrades
- Support per your plan

## Your ongoing rhythm

| Frequency | Do this |
| --- | --- |
| Daily | Ask the AI Assistant what needs attention |
| Weekly | Review Analytics; clear CRM follow-ups |
| Monthly | Review results; refine knowledge and templates |

> [!TIP] The businesses that get the most from AutomateIQ treat the AI Assistant like a team member — they check in with it daily. Build the habit early.

## Sign-off

Once the checklist above is complete, your handover is done. Welcome to the ongoing AutomateIQ experience.`,
  },
  {
    slug: "training-manual",
    title: "Training Manual",
    category: "Using AutomateIQ",
    icon: "book-open",
    summary: "A structured guide to training your team on every agent.",
    sortOrder: 10,
    content: `# Training Manual

This manual trains your team to use AutomateIQ confidently. Work through each module; each takes about ten minutes.

## Module 1 — The dashboard & AI Assistant

Your dashboard is mission control. The AI Assistant is how you get things done.

- Open the AI Assistant and ask: *"What should I focus on today?"*
- Try a task: *"Send a review request to [name] at [email]"*
- Notice the action chips showing what the assistant did

> [!TIP] You rarely need to open individual agents — just ask the assistant in plain English and it runs the right one.

## Module 2 — Reviews

- Open the Review Agent
- Send a request; watch it move through sent → clicked
- Review the History tab

## Module 3 — Quotes

- Add your price guide
- Create a quote from a job description
- Send it and see the customer's accept/decline update the pipeline

## Module 4 — Content

- Launch a campaign with a theme
- Review the generated blog, social and email
- Schedule and publish

## Module 5 — CRM

- Click "Import from agents"
- Open a contact and read its timeline
- Add a follow-up task

## Competency checklist

- [ ] Can complete a task via the AI Assistant
- [ ] Can send a review request
- [ ] Can create and send a quote
- [ ] Can launch a content campaign
- [ ] Can find a contact and log a note

Once every team member can tick these boxes, your team is trained.`,
  },
  {
    slug: "user-guide",
    title: "User Guide",
    category: "Using AutomateIQ",
    icon: "book",
    summary: "Reference guide to every part of the platform.",
    sortOrder: 20,
    content: `# User Guide

A reference to every area of AutomateIQ. Use it to look things up as you go.

## Navigation

| Area | What it's for |
| --- | --- |
| Dashboard | Your daily overview, health score and quick actions |
| AI Assistant | Ask anything; it runs your agents |
| Products | Every agent you have and what's available |
| Analytics | Results across every agent |
| Projects | Custom modules and your documents |
| Team | Who has access |
| Billing | Your plan and usage |
| Settings | Business knowledge, branding, security |

## Managing your team

Add colleagues from **Team**. Everyone on your business shares the same data, scoped securely to your account.

## Business knowledge

Under **Settings → Business knowledge**, keep your services, prices and policies current. Every AI agent reads this.

## Security

- Change your password under **Settings → Security**
- Each login is scoped to your business only — you can never see another business's data, and they can never see yours

> [!IMPORTANT] Your data is isolated at the database level, not just hidden in the interface. This is enforced for every request.

## Getting help

- Ask the AI Assistant first — it can answer most questions
- See the **Support Guide** for response times and how to reach a human`,
  },
  {
    slug: "faq",
    title: "Frequently Asked Questions",
    category: "Using AutomateIQ",
    icon: "help-circle",
    summary: "Quick answers to the questions we hear most.",
    sortOrder: 30,
    content: `# Frequently Asked Questions

## Getting started

**How long until I see results?**
Most clients send their first review request or quote on day one. Meaningful momentum builds over the first two weeks.

**Do I need technical skills?**
No. If you can send an email, you can use AutomateIQ. The AI Assistant does the heavy lifting.

## The AI agents

**Will the AI make things up about my business?**
No. The agents only use the information in your Business Knowledge and price guide. Anything they don't know, they leave out rather than invent.

**Can I edit what the AI produces?**
Always. Content, quotes and messages are yours to edit before they go out.

**What happens if an agent gets something wrong?**
Nothing goes to a customer without you choosing to send it (except the Speed-to-Lead auto-reply, which you fully control the wording of). You're always in control.

## Data & security

**Can other businesses see my data?**
Never. Your data is isolated at the database level for every request.

**Is my data used to train AI models?**
Your business data is used to help *your* agents serve *you*. See the **AI Usage Policy** and **Security & GDPR Guide** for full detail.

## Billing & plans

**Can I add or remove agents?**
Yes — talk to us and we'll adjust your plan. See the **Change Request Form**.

**What if I need something custom?**
Custom modules are built for exactly how your business works. Raise a Change Request.

> [!TIP] Can't find your answer? Ask the AI Assistant — it knows your account — or email hello@automateiq.ie.`,
  },
  {
    slug: "support-guide",
    title: "Support Guide",
    category: "Support & Operations",
    icon: "life-buoy",
    summary: "How to get help and what to expect.",
    sortOrder: 10,
    content: `# Support Guide

We're here when you need us. This guide explains how to get help and how quickly you'll hear back.

## How to get help

| Channel | Best for |
| --- | --- |
| AI Assistant | Instant answers about your account |
| hello@automateiq.ie | Anything the assistant can't resolve |
| Your onboarding specialist | During your first two weeks |

## Response times

| Priority | Definition | Target first response |
| --- | --- | --- |
| Urgent | Platform down or unusable | 2 business hours |
| High | A key feature not working | 1 business day |
| Normal | Questions, small issues | 2 business days |
| Low | Suggestions, nice-to-haves | Best effort |

> [!NOTE] Business hours are Monday–Friday, 9am–5pm. Urgent issues raised outside these hours are picked up the next business morning.

## Helping us help you

When you report an issue, include:

- [ ] What you were trying to do
- [ ] What happened instead
- [ ] Which agent or page
- [ ] A screenshot if you can

## Escalation

If you don't hear back within the target time, reply to your ticket with "ESCALATE" in the subject and it will be prioritised.

For the full commitments, see the **Maintenance & SLA** document.`,
  },
  {
    slug: "maintenance-sla",
    title: "Maintenance & SLA",
    category: "Support & Operations",
    icon: "shield-check",
    summary: "Our service level commitments and maintenance approach.",
    sortOrder: 20,
    content: `# Maintenance & Service Level Agreement

This document sets out our commitments for availability, maintenance and support.

## Availability

We target **99.5% monthly uptime** for the AutomateIQ platform, excluding scheduled maintenance.

| Metric | Commitment |
| --- | --- |
| Uptime target | 99.5% / month |
| Scheduled maintenance | Announced in advance, off-peak where possible |
| Data backups | Automated, daily |

## Maintenance

- Routine maintenance and upgrades are applied continuously with no downtime where possible.
- Any maintenance requiring downtime is scheduled outside business hours and communicated ahead of time.
- Security patches are applied promptly.

## Support commitments

Response targets are defined in the **Support Guide**. Resolution targets:

| Priority | Target resolution |
| --- | --- |
| Urgent | Same business day |
| High | 2 business days |
| Normal | 5 business days |
| Low | Best effort |

## Your responsibilities

- Keep your account credentials secure
- Report issues promptly with detail
- Keep your business information accurate

## Exclusions

The SLA does not cover issues caused by third-party services outside our control, incorrect information provided to the platform, or misuse.

> [!IMPORTANT] Nothing in this SLA reduces your rights under applicable law. It sets out our operational commitments to you.`,
  },
  {
    slug: "incident-response-guide",
    title: "Incident Response Guide",
    category: "Support & Operations",
    icon: "alert-triangle",
    summary: "How we handle incidents and what you can expect.",
    sortOrder: 30,
    content: `# Incident Response Guide

An incident is any unplanned event that disrupts the platform or puts data at risk. This guide explains how we respond and how we keep you informed.

## Severity levels

| Level | Meaning | Example |
| --- | --- | --- |
| SEV-1 | Critical outage or data risk | Platform down; suspected breach |
| SEV-2 | Major feature unavailable | An agent not sending |
| SEV-3 | Minor / degraded | Slowness; cosmetic issue |

## Our response process

1. **Detect** — automated monitoring and customer reports
2. **Triage** — assign severity and an owner
3. **Contain** — stop the impact spreading
4. **Resolve** — fix the root cause
5. **Communicate** — keep affected customers updated
6. **Review** — post-incident review to prevent recurrence

## Communication

> [!IMPORTANT] For any SEV-1 incident affecting your account, we will contact your primary contact directly with what's happening, the impact, and our expected resolution.

For SEV-2 and SEV-3, updates are provided through your support ticket.

## Data incidents

If a data incident occurs, we follow our breach procedure in the **Security & GDPR Guide**, including regulator and data-subject notification where legally required, within the required timeframes.

## What you should do

- [ ] Report anything suspicious immediately
- [ ] Keep your primary contact details current
- [ ] Follow any instructions we provide during an incident`,
  },
  {
    slug: "security-gdpr-guide",
    title: "Security & GDPR Guide",
    category: "Trust & Compliance",
    icon: "lock",
    summary: "How we protect your data and comply with GDPR.",
    sortOrder: 10,
    content: `# Security & GDPR Guide

Your trust is the foundation of this platform. This guide explains how we secure your data and how we comply with the GDPR.

## How your data is protected

| Control | What it means |
| --- | --- |
| Tenant isolation | Your data is separated from every other customer at the database level (Row-Level Security), enforced on every request — not just hidden in the interface |
| Encryption | Data is encrypted in transit (TLS) and at rest |
| Access control | Role-based access; staff access is least-privilege and audited |
| Backups | Automated daily backups |

> [!IMPORTANT] Isolation is enforced by the database, not the frontend. Even if the interface were bypassed, one customer still cannot read another's data.

## GDPR compliance

**Lawful basis.** We process personal data to provide the service you've contracted (contractual necessity) and for legitimate business interests, with consent where required.

**Your role.** For the customer and lead data you put into the platform, you are the data controller and AutomateIQ is your data processor. We process it only on your instructions.

**Data subject rights.** We support your obligations to data subjects:

- [ ] Right of access
- [ ] Right to rectification
- [ ] Right to erasure
- [ ] Right to restrict processing
- [ ] Right to data portability

Contact us and we will help you fulfil any request within the statutory timeframe.

## Sub-processors

We use reputable sub-processors (e.g. cloud hosting, email delivery, AI providers) under data-processing agreements. A current list is available on request.

## Data retention & deletion

- Your data is retained for the life of your account.
- On request or account closure, data is deleted or returned per our agreement, subject to any legal retention obligations.

## Breach procedure

In the event of a personal-data breach, we notify affected controllers without undue delay and support regulator/data-subject notification where legally required.

> [!NOTE] Questions about security or a specific compliance requirement? Email hello@automateiq.ie and we'll respond, including providing a DPA if you need one.`,
  },
  {
    slug: "ai-usage-policy",
    title: "AI Usage Policy",
    category: "Trust & Compliance",
    icon: "cpu",
    summary: "How AutomateIQ uses AI responsibly on your behalf.",
    sortOrder: 20,
    content: `# AI Usage Policy

AutomateIQ uses AI to do real work for your business. This policy explains how we do that responsibly, and what you can rely on.

## Our principles

- **You're in control.** Nothing goes to a customer without your say-so, other than automations you explicitly configure (like the Speed-to-Lead reply, whose wording you own).
- **Grounded, not guessing.** Agents use your Business Knowledge and price guide. They don't invent prices, availability or policies.
- **Your voice.** Content is generated in the tone you set, for you to review and edit.
- **Transparency.** When the AI Assistant takes an action, it tells you what it did.

## How AI is used per agent

| Agent | AI's role |
| --- | --- |
| AI Assistant | Understands your request and calls the right agent |
| Content Agent | Drafts content in your brand voice |
| Instant Quote Agent | Structures a quote from your price guide only |
| Review / Speed-to-Lead | Personalise messages you've approved |

## What the AI does *not* do

- It does not make financial or contractual commitments on your behalf.
- It does not invent facts about your business.
- It does not act on another business's data — ever.

## Data & model use

- Your business data is used to help your agents serve you.
- We use reputable AI providers under data-processing terms.
- See the **Security & GDPR Guide** for how data is protected.

## Human oversight

> [!IMPORTANT] AI assists; you decide. We recommend reviewing AI-generated content and quotes before they go to customers, especially early on while you calibrate your Business Knowledge.

## Responsible use

You agree to use AutomateIQ's AI features lawfully and not to generate misleading, harmful or unlawful content. We reserve the right to suspend misuse.

Questions about how AI is used on your account? Ask the AI Assistant or email hello@automateiq.ie.`,
  },
];
