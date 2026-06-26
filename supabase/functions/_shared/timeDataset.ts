/**
 * Occupation-specific task durations — filtered subset of docs/time_data_compact.json
 * (ATUS 2024 + O*NET sourced, 135 entries across 21 named occupations).
 *
 * Only rows tagged with a SPECIFIC occupation are included. Rows tagged
 * "General Population" / "General / Daily Life" in the source file are
 * ATUS daily-average-across-everyone figures, not single-session lengths
 * (e.g. "Walking/exercising pets: 5.1min") — using those directly would
 * schedule a 5-minute dog walk. activityDurations.ts already hand-curates
 * around that same trap for non-profession categories; this file exists
 * for *deterministic, code-level* matching, not AI prompt text.
 *
 * Used by durationLookup.ts to resolve a task title to a real-world
 * duration WITHOUT calling Gemini, when there is a confident match.
 */

export interface TimeDatasetRow {
  category: string;
  occupation: string;
  task: string;
  min: number;
}

export const TIME_DATASET: readonly TimeDatasetRow[] = [
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Analytics & strategy",
    "min": 30.0
  },
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Community management & comments",
    "min": 30.0
  },
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Filming / recording content",
    "min": 120.0
  },
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Scriptwriting & planning",
    "min": 60.0
  },
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Sponsorship & email admin",
    "min": 30.0
  },
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Thumbnail & graphic design",
    "min": 30.0
  },
  {
    "category": "Creative",
    "occupation": "Video Creator / YouTuber",
    "task": "Video editing",
    "min": 180.0
  },
  {
    "category": "Creative",
    "occupation": "Writer / Copywriter",
    "task": "Client briefing & revisions",
    "min": 45.0
  },
  {
    "category": "Creative",
    "occupation": "Writer / Copywriter",
    "task": "Editing & proofreading",
    "min": 60.0
  },
  {
    "category": "Creative",
    "occupation": "Writer / Copywriter",
    "task": "Email & admin",
    "min": 30.0
  },
  {
    "category": "Creative",
    "occupation": "Writer / Copywriter",
    "task": "Research & fact-checking",
    "min": 90.0
  },
  {
    "category": "Creative",
    "occupation": "Writer / Copywriter",
    "task": "SEO & content planning",
    "min": 45.0
  },
  {
    "category": "Creative",
    "occupation": "Writer / Copywriter",
    "task": "Writing (articles, copy, scripts)",
    "min": 180.0
  },
  {
    "category": "Customer Service",
    "occupation": "Customer Support Agent",
    "task": "Documentation & knowledge base",
    "min": 45.0
  },
  {
    "category": "Customer Service",
    "occupation": "Customer Support Agent",
    "task": "Internal meetings & training",
    "min": 45.0
  },
  {
    "category": "Customer Service",
    "occupation": "Customer Support Agent",
    "task": "Issue investigation & escalation",
    "min": 60.0
  },
  {
    "category": "Customer Service",
    "occupation": "Customer Support Agent",
    "task": "Live chat & phone support",
    "min": 120.0
  },
  {
    "category": "Customer Service",
    "occupation": "Customer Support Agent",
    "task": "Reporting & quality review",
    "min": 30.0
  },
  {
    "category": "Customer Service",
    "occupation": "Customer Support Agent",
    "task": "Responding to customer tickets/emails",
    "min": 180.0
  },
  {
    "category": "Design",
    "occupation": "Graphic Designer",
    "task": "Asset preparation & export",
    "min": 45.0
  },
  {
    "category": "Design",
    "occupation": "Graphic Designer",
    "task": "Briefing & concept development",
    "min": 60.0
  },
  {
    "category": "Design",
    "occupation": "Graphic Designer",
    "task": "Client communication & revisions",
    "min": 60.0
  },
  {
    "category": "Design",
    "occupation": "Graphic Designer",
    "task": "Email & admin",
    "min": 30.0
  },
  {
    "category": "Design",
    "occupation": "Graphic Designer",
    "task": "Research & inspiration",
    "min": 30.0
  },
  {
    "category": "Design",
    "occupation": "Graphic Designer",
    "task": "Visual design creation",
    "min": 180.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "Design reviews & feedback",
    "min": 45.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "Documentation & handoff",
    "min": 30.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "Learning new tools & trends",
    "min": 30.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "Meetings & collaboration",
    "min": 60.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "User research & interviews",
    "min": 60.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "Visual design (mockups, assets)",
    "min": 120.0
  },
  {
    "category": "Design",
    "occupation": "UI/UX Designer",
    "task": "Wireframing & prototyping",
    "min": 120.0
  },
  {
    "category": "Education",
    "occupation": "Teacher",
    "task": "Administrative tasks",
    "min": 30.0
  },
  {
    "category": "Education",
    "occupation": "Teacher",
    "task": "Grading & assessment",
    "min": 60.0
  },
  {
    "category": "Education",
    "occupation": "Teacher",
    "task": "Lesson planning & prep",
    "min": 90.0
  },
  {
    "category": "Education",
    "occupation": "Teacher",
    "task": "Professional development",
    "min": 20.0
  },
  {
    "category": "Education",
    "occupation": "Teacher",
    "task": "Student support & communication",
    "min": 45.0
  },
  {
    "category": "Education",
    "occupation": "Teacher",
    "task": "Teaching / instruction",
    "min": 200.0
  },
  {
    "category": "Finance",
    "occupation": "Accountant",
    "task": "Auditing & reconciliation",
    "min": 60.0
  },
  {
    "category": "Finance",
    "occupation": "Accountant",
    "task": "Client communication",
    "min": 60.0
  },
  {
    "category": "Finance",
    "occupation": "Accountant",
    "task": "Financial data entry & bookkeeping",
    "min": 120.0
  },
  {
    "category": "Finance",
    "occupation": "Accountant",
    "task": "Financial reporting & analysis",
    "min": 90.0
  },
  {
    "category": "Finance",
    "occupation": "Accountant",
    "task": "Meetings & admin",
    "min": 30.0
  },
  {
    "category": "Finance",
    "occupation": "Accountant",
    "task": "Tax preparation & compliance",
    "min": 90.0
  },
  {
    "category": "Fitness & Sports",
    "occupation": "Fitness Trainer",
    "task": "Admin & scheduling",
    "min": 30.0
  },
  {
    "category": "Fitness & Sports",
    "occupation": "Fitness Trainer",
    "task": "Client assessment & check-ins",
    "min": 60.0
  },
  {
    "category": "Fitness & Sports",
    "occupation": "Fitness Trainer",
    "task": "Conducting training sessions",
    "min": 240.0
  },
  {
    "category": "Fitness & Sports",
    "occupation": "Fitness Trainer",
    "task": "Marketing & social media",
    "min": 30.0
  },
  {
    "category": "Fitness & Sports",
    "occupation": "Fitness Trainer",
    "task": "Own training & education",
    "min": 60.0
  },
  {
    "category": "Fitness & Sports",
    "occupation": "Fitness Trainer",
    "task": "Program design & planning",
    "min": 60.0
  },
  {
    "category": "Food & Hospitality",
    "occupation": "Chef / Cook",
    "task": "Cleaning & compliance",
    "min": 60.0
  },
  {
    "category": "Food & Hospitality",
    "occupation": "Chef / Cook",
    "task": "Food preparation & cooking",
    "min": 300.0
  },
  {
    "category": "Food & Hospitality",
    "occupation": "Chef / Cook",
    "task": "Kitchen management & orders",
    "min": 45.0
  },
  {
    "category": "Food & Hospitality",
    "occupation": "Chef / Cook",
    "task": "Menu planning & recipe development",
    "min": 45.0
  },
  {
    "category": "Food & Hospitality",
    "occupation": "Chef / Cook",
    "task": "Staff coordination",
    "min": 30.0
  },
  {
    "category": "Freelance",
    "occupation": "Freelancer / Self-employed",
    "task": "Client work / billable tasks",
    "min": 240.0
  },
  {
    "category": "Freelance",
    "occupation": "Freelancer / Self-employed",
    "task": "Email & client communication",
    "min": 45.0
  },
  {
    "category": "Freelance",
    "occupation": "Freelancer / Self-employed",
    "task": "Finding clients & proposals",
    "min": 60.0
  },
  {
    "category": "Freelance",
    "occupation": "Freelancer / Self-employed",
    "task": "Invoicing & admin",
    "min": 30.0
  },
  {
    "category": "Freelance",
    "occupation": "Freelancer / Self-employed",
    "task": "Learning & skill development",
    "min": 30.0
  },
  {
    "category": "Freelance",
    "occupation": "Freelancer / Self-employed",
    "task": "Marketing & social media",
    "min": 45.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "Benefits & payroll admin",
    "min": 60.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "Conflict resolution & support",
    "min": 30.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "Email & employee communication",
    "min": 90.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "Employee onboarding & offboarding",
    "min": 60.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "HR system & documentation",
    "min": 60.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "Meetings & policy work",
    "min": 60.0
  },
  {
    "category": "HR",
    "occupation": "HR Specialist",
    "task": "Recruiting & interviewing",
    "min": 120.0
  },
  {
    "category": "Healthcare",
    "occupation": "Nurse",
    "task": "Coordination with medical team",
    "min": 30.0
  },
  {
    "category": "Healthcare",
    "occupation": "Nurse",
    "task": "Documentation & charting",
    "min": 90.0
  },
  {
    "category": "Healthcare",
    "occupation": "Nurse",
    "task": "Medication administration",
    "min": 60.0
  },
  {
    "category": "Healthcare",
    "occupation": "Nurse",
    "task": "Patient care & monitoring",
    "min": 240.0
  },
  {
    "category": "Healthcare",
    "occupation": "Nurse",
    "task": "Patient education & communication",
    "min": 45.0
  },
  {
    "category": "Healthcare",
    "occupation": "Nurse",
    "task": "Procedures & treatments",
    "min": 30.0
  },
  {
    "category": "Healthcare",
    "occupation": "Physician",
    "task": "Admin & insurance paperwork",
    "min": 30.0
  },
  {
    "category": "Healthcare",
    "occupation": "Physician",
    "task": "Medical documentation (EHR)",
    "min": 120.0
  },
  {
    "category": "Healthcare",
    "occupation": "Physician",
    "task": "Patient consultations & exams",
    "min": 210.0
  },
  {
    "category": "Healthcare",
    "occupation": "Physician",
    "task": "Prescribing & treatment planning",
    "min": 45.0
  },
  {
    "category": "Healthcare",
    "occupation": "Physician",
    "task": "Reviewing test results & labs",
    "min": 60.0
  },
  {
    "category": "Healthcare",
    "occupation": "Physician",
    "task": "Team coordination & rounds",
    "min": 30.0
  },
  {
    "category": "Legal",
    "occupation": "Lawyer",
    "task": "Administrative & billing",
    "min": 30.0
  },
  {
    "category": "Legal",
    "occupation": "Lawyer",
    "task": "Client meetings & consultation",
    "min": 90.0
  },
  {
    "category": "Legal",
    "occupation": "Lawyer",
    "task": "Court appearances & hearings",
    "min": 60.0
  },
  {
    "category": "Legal",
    "occupation": "Lawyer",
    "task": "Drafting documents & contracts",
    "min": 120.0
  },
  {
    "category": "Legal",
    "occupation": "Lawyer",
    "task": "Email & correspondence",
    "min": 60.0
  },
  {
    "category": "Legal",
    "occupation": "Lawyer",
    "task": "Legal research & analysis",
    "min": 120.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "Competitive research",
    "min": 30.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "Data analysis & metrics",
    "min": 45.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "Email & communication",
    "min": 60.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "Meetings (design, dev, stakeholders)",
    "min": 150.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "Roadmap planning & prioritization",
    "min": 90.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "User research & feedback analysis",
    "min": 60.0
  },
  {
    "category": "Management",
    "occupation": "Product Manager",
    "task": "Writing specs & PRDs",
    "min": 60.0
  },
  {
    "category": "Management",
    "occupation": "Project Manager",
    "task": "Documentation & status reports",
    "min": 60.0
  },
  {
    "category": "Management",
    "occupation": "Project Manager",
    "task": "Email & communication",
    "min": 90.0
  },
  {
    "category": "Management",
    "occupation": "Project Manager",
    "task": "Meetings & standups",
    "min": 120.0
  },
  {
    "category": "Management",
    "occupation": "Project Manager",
    "task": "Planning & scheduling",
    "min": 90.0
  },
  {
    "category": "Management",
    "occupation": "Project Manager",
    "task": "Risk assessment & reporting",
    "min": 45.0
  },
  {
    "category": "Management",
    "occupation": "Project Manager",
    "task": "Stakeholder management",
    "min": 45.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Analytics & reporting",
    "min": 60.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Campaign planning & strategy",
    "min": 60.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Content creation (copy, posts)",
    "min": 120.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Email marketing",
    "min": 45.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Market research",
    "min": 45.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Meetings & collaboration",
    "min": 60.0
  },
  {
    "category": "Marketing",
    "occupation": "Marketing Specialist",
    "task": "Social media management",
    "min": 60.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "CRM data entry & updates",
    "min": 45.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "Email & follow-ups",
    "min": 90.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "Internal meetings & reporting",
    "min": 45.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "Networking & relationship building",
    "min": 30.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "Proposal & contract prep",
    "min": 45.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "Prospecting & lead generation",
    "min": 90.0
  },
  {
    "category": "Sales",
    "occupation": "Sales Representative",
    "task": "Sales calls & demos",
    "min": 120.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Data Analyst",
    "task": "Dashboard & visualization",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Data Analyst",
    "task": "Data analysis & modeling",
    "min": 120.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Data Analyst",
    "task": "Data cleaning & preparation",
    "min": 120.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Data Analyst",
    "task": "Meetings & stakeholder comms",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Data Analyst",
    "task": "Reporting & presentations",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Data Analyst",
    "task": "SQL / querying databases",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "App Store submission & maintenance",
    "min": 20.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "App development (iOS/Android)",
    "min": 180.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "Code review & refactoring",
    "min": 45.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "Documentation",
    "min": 30.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "Meetings & planning",
    "min": 45.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "Research & learning",
    "min": 45.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "Testing & QA",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Mobile App Developer",
    "task": "User feedback & analytics review",
    "min": 30.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Code review",
    "min": 45.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Debugging & testing",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Documentation",
    "min": 30.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Email & communication",
    "min": 30.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Learning / research",
    "min": 30.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Meetings & standups",
    "min": 45.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Planning & design",
    "min": 60.0
  },
  {
    "category": "Tech & IT",
    "occupation": "Software Developer",
    "task": "Writing code / programming",
    "min": 180.0
  }
] as const;
