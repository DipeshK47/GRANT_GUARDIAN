export type NotionColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type NotionSelectOption = {
  name: string;
  color?: NotionColor;
};

export type NotionPropertyDefinition =
  | {
      name: string;
      type: "title";
    }
  | {
      name: string;
      type: "rich_text";
    }
  | {
      name: string;
      type: "url";
    }
  | {
      name: string;
      type: "checkbox";
    }
  | {
      name: string;
      type: "date";
    }
  | {
      name: string;
      type: "number";
      format?: "number" | "dollar" | "percent";
    }
  | {
      name: string;
      type: "select";
      options: NotionSelectOption[];
    }
  | {
      name: string;
      type: "multi_select";
      options: NotionSelectOption[];
    }
  | {
      name: string;
      type: "relation";
      dataSourceKey: string;
    };

export type NotionWorkspaceDatabaseDefinition = {
  key: string;
  name: string;
  description: string;
  icon: string;
  properties: NotionPropertyDefinition[];
};

export const grantGuardianRootPageDefinition = {
  title: "Grant Guardian Workspace",
  icon: "🛡️",
  children: [
    {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [
          {
            type: "text",
            text: {
              content: "Grant Guardian",
            },
          },
        ],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                "This workspace is the home base for funder intelligence, evidence coverage, grounded drafting, reviews, submissions, and post-award reporting.",
            },
          },
        ],
      },
    },
    {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                "Start in Organization and Programs to define reusable nonprofit context.",
            },
          },
        ],
      },
    },
    {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                "Paste a new funder or RFP into Opportunities when intake flows are wired in.",
            },
          },
        ],
      },
    },
    {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                "Track grant fit, missing evidence, rejection memory, and reporting obligations from here.",
            },
          },
        ],
      },
    },
  ],
} as const;

const priorityOptions: NotionSelectOption[] = [
  { name: "Critical", color: "red" },
  { name: "High", color: "orange" },
  { name: "Medium", color: "yellow" },
  { name: "Low", color: "gray" },
];

const geographyOptions: NotionSelectOption[] = [
  { name: "Atlanta", color: "blue" },
  { name: "Dekalb County", color: "green" },
  { name: "Georgia", color: "yellow" },
  { name: "Southeast", color: "orange" },
  { name: "National", color: "purple" },
];

const evidenceTagOptions: NotionSelectOption[] = [
  { name: "literacy", color: "blue" },
  { name: "outcomes", color: "green" },
  { name: "evaluation", color: "yellow" },
  { name: "family engagement", color: "orange" },
  { name: "survey", color: "purple" },
  { name: "testimonials", color: "pink" },
  { name: "mentoring", color: "red" },
];

const confidenceOptions: NotionSelectOption[] = [
  { name: "High", color: "green" },
  { name: "Medium", color: "yellow" },
  { name: "Low", color: "orange" },
  { name: "Needs Review", color: "red" },
];

const foundationTypeOptions: NotionSelectOption[] = [
  { name: "Private foundation", color: "blue" },
  { name: "Corporate foundation", color: "purple" },
  { name: "Family foundation", color: "green" },
  { name: "Community foundation", color: "yellow" },
  { name: "Government", color: "orange" },
  { name: "Other", color: "gray" },
];

const issueAreaOptions: NotionSelectOption[] = [
  { name: "Youth education", color: "blue" },
  { name: "Economic mobility", color: "green" },
  { name: "Workforce development", color: "yellow" },
  { name: "Community spaces", color: "orange" },
  { name: "Infrastructure", color: "purple" },
  { name: "Small towns", color: "pink" },
];

const filingTypeOptions: NotionSelectOption[] = [
  { name: "990-PF", color: "blue" },
  { name: "990", color: "purple" },
  { name: "Other", color: "gray" },
];

const parseStatusOptions: NotionSelectOption[] = [
  { name: "Queued", color: "gray" },
  { name: "Parsed", color: "green" },
  { name: "Partial", color: "yellow" },
  { name: "Failed", color: "red" },
];

const opportunityStatusOptions: NotionSelectOption[] = [
  { name: "Intake", color: "gray" },
  { name: "Researching", color: "blue" },
  { name: "Drafting", color: "yellow" },
  { name: "Review", color: "orange" },
  { name: "Submitted", color: "green" },
  { name: "Awarded", color: "purple" },
  { name: "Rejected", color: "red" },
];

const pursueDecisionOptions: NotionSelectOption[] = [
  { name: "Pursue", color: "green" },
  { name: "Revisit", color: "yellow" },
  { name: "Skip", color: "red" },
  { name: "Pursue Now", color: "green" },
  { name: "Revisit Later", color: "yellow" },
];

const requirementTypeOptions: NotionSelectOption[] = [
  { name: "Narrative", color: "blue" },
  { name: "Narrative Question", color: "blue" },
  { name: "Document upload", color: "purple" },
  { name: "Document", color: "purple" },
  { name: "Budget", color: "green" },
  { name: "Eligibility", color: "gray" },
  { name: "Portal Field", color: "orange" },
];

const coverageStatusOptions: NotionSelectOption[] = [
  { name: "Green", color: "green" },
  { name: "Amber", color: "yellow" },
  { name: "Red", color: "red" },
];

const riskOptions: NotionSelectOption[] = [
  { name: "Low", color: "green" },
  { name: "Medium", color: "yellow" },
  { name: "High", color: "red" },
];

const evidenceTypeOptions: NotionSelectOption[] = [
  { name: "Metric", color: "blue" },
  { name: "Outcome", color: "green" },
  { name: "Outcomes data", color: "green" },
  { name: "Testimonial", color: "yellow" },
  { name: "Budget Fact", color: "orange" },
  { name: "Narrative Boilerplate", color: "purple" },
];

const reusabilityOptions: NotionSelectOption[] = [
  { name: "High", color: "green" },
  { name: "Medium", color: "yellow" },
  { name: "Low", color: "red" },
];

const documentCategoryOptions: NotionSelectOption[] = [
  { name: "501(c)(3)", color: "blue" },
  { name: "Audit", color: "green" },
  { name: "Budget", color: "yellow" },
  { name: "Board List", color: "orange" },
  { name: "Policy", color: "gray" },
  { name: "Other", color: "purple" },
];

const uploadStatusOptions: NotionSelectOption[] = [
  { name: "Ready", color: "green" },
  { name: "Missing", color: "red" },
  { name: "Updating", color: "yellow" },
];

const budgetTypeOptions: NotionSelectOption[] = [
  { name: "Organizational", color: "blue" },
  { name: "Program", color: "green" },
  { name: "Project", color: "purple" },
];

const draftStatusOptions: NotionSelectOption[] = [
  { name: "Not Started", color: "gray" },
  { name: "Draft", color: "blue" },
  { name: "Drafting", color: "blue" },
  { name: "Needs Review", color: "yellow" },
  { name: "Approved", color: "green" },
];

const taskStatusOptions: NotionSelectOption[] = [
  { name: "To Do", color: "gray" },
  { name: "In Progress", color: "blue" },
  { name: "Blocked", color: "red" },
  { name: "Done", color: "green" },
];

const reviewTypeOptions: NotionSelectOption[] = [
  { name: "Draft Review", color: "blue" },
  { name: "Compliance Review", color: "purple" },
  { name: "Submission Approval", color: "orange" },
];

const reviewStatusOptions: NotionSelectOption[] = [
  { name: "Requested", color: "gray" },
  { name: "In Review", color: "blue" },
  { name: "Changes Requested", color: "red" },
  { name: "Approved", color: "green" },
];

const submissionMethodOptions: NotionSelectOption[] = [
  { name: "Submittable", color: "blue" },
  { name: "Email", color: "green" },
  { name: "Email / Direct application", color: "green" },
  { name: "Portal", color: "purple" },
  { name: "Other", color: "gray" },
];

const submissionReadyOptions: NotionSelectOption[] = [
  { name: "Preparing", color: "gray" },
  { name: "Ready", color: "green" },
  { name: "Submitted", color: "blue" },
];

const reportStatusOptions: NotionSelectOption[] = [
  { name: "Not started", color: "gray" },
  { name: "Upcoming", color: "gray" },
  { name: "In Progress", color: "blue" },
  { name: "Submitted", color: "green" },
  { name: "Overdue", color: "red" },
];

const rejectionThemeOptions: NotionSelectOption[] = [
  { name: "Evaluation Weakness", color: "red" },
  { name: "Budget Mismatch", color: "orange" },
  { name: "Geographic Fit", color: "yellow" },
  { name: "Capacity Concerns", color: "purple" },
  { name: "Outcomes Unclear", color: "blue" },
  { name: "Geography mismatch", color: "yellow" },
  { name: "Eligibility failure", color: "red" },
  { name: "Program type mismatch", color: "orange" },
];

const lessonResultOptions: NotionSelectOption[] = [
  { name: "Rejected", color: "red" },
  { name: "Awarded", color: "green" },
  { name: "Withdrawn", color: "gray" },
];

const agentConfidenceOptions: NotionSelectOption[] = [
  { name: "High", color: "green" },
  { name: "Medium", color: "yellow" },
  { name: "Low", color: "red" },
];

const agentOptions: NotionSelectOption[] = [
  { name: "Intake Agent", color: "blue" },
  { name: "Fit Agent", color: "green" },
  { name: "Evidence Agent", color: "yellow" },
  { name: "Narrative Agent", color: "purple" },
  { name: "Review Agent", color: "orange" },
  { name: "Submission Agent", color: "pink" },
  { name: "Compliance Agent", color: "red" },
  { name: "Funder Intelligence Agent", color: "red" },
  { name: "Funder Filing Parser Agent", color: "yellow" },
  { name: "Portal Discovery Agent", color: "pink" },
  { name: "Portal Mapping Agent", color: "pink" },
  { name: "Attachment Staging Agent", color: "pink" },
  { name: "Submission Autopilot Agent", color: "pink" },
  { name: "Portal Schema Agent", color: "pink" },
  { name: "Document Vault Agent", color: "gray" },
];

export const notionWorkspaceDatabases: NotionWorkspaceDatabaseDefinition[] = [
  {
    key: "organization",
    name: "Organization",
    description: "Reusable nonprofit identity, budget, geography, and boilerplate.",
    icon: "🏢",
    properties: [
      { name: "Name", type: "title" },
      { name: "EIN", type: "rich_text" },
      { name: "Mission", type: "rich_text" },
      { name: "Annual Budget", type: "number", format: "dollar" },
      { name: "Staff Size", type: "number" },
      { name: "Founding Year", type: "number" },
      { name: "Executive Director", type: "rich_text" },
      { name: "Grants Contact", type: "rich_text" },
      { name: "Address", type: "rich_text" },
      { name: "Service Areas", type: "multi_select", options: geographyOptions },
      { name: "Program Areas", type: "multi_select", options: issueAreaOptions },
      { name: "Website", type: "url" },
    ],
  },
  {
    key: "programs",
    name: "Programs",
    description: "Programs, outcomes, metrics, and reusable evidence foundations.",
    icon: "📚",
    properties: [
      { name: "Program Name", type: "title" },
      { name: "Organization", type: "relation", dataSourceKey: "organization" },
      { name: "Target Population", type: "rich_text" },
      { name: "Geography", type: "multi_select", options: geographyOptions },
      { name: "Goals", type: "rich_text" },
      { name: "Outcomes", type: "rich_text" },
      { name: "Metrics", type: "rich_text" },
      { name: "Program Budget", type: "number", format: "dollar" },
      { name: "Program Lead", type: "rich_text" },
      { name: "Strategic Priority", type: "select", options: priorityOptions },
    ],
  },
  {
    key: "funders",
    name: "Funders",
    description: "Funder records enriched with 990 intelligence, Grant DNA, and lessons learned.",
    icon: "🏛️",
    properties: [
      { name: "Funder Name", type: "title" },
      { name: "EIN", type: "rich_text" },
      { name: "Website", type: "url" },
      { name: "Foundation Type", type: "select", options: foundationTypeOptions },
      { name: "Issue Areas", type: "multi_select", options: issueAreaOptions },
      { name: "Average Grant", type: "number", format: "dollar" },
      { name: "Median Grant", type: "number", format: "dollar" },
      { name: "Geographic Focus", type: "multi_select", options: geographyOptions },
      { name: "Giving Summary", type: "rich_text" },
      { name: "Grant DNA Top Terms", type: "rich_text" },
      { name: "Framing Style", type: "rich_text" },
      { name: "Tone Summary", type: "rich_text" },
      { name: "Notes", type: "rich_text" },
      { name: "Small-Org Friendly", type: "select", options: confidenceOptions },
    ],
  },
  {
    key: "funder-filings",
    name: "Funder Filings",
    description: "Parsed 990-PF filing metadata and audit trail.",
    icon: "🧾",
    properties: [
      { name: "Filing Record", type: "title" },
      { name: "Funder", type: "relation", dataSourceKey: "funders" },
      { name: "Tax Year", type: "number" },
      { name: "Filing Type", type: "select", options: filingTypeOptions },
      { name: "Parsed Status", type: "select", options: parseStatusOptions },
      { name: "Grant Count", type: "number" },
      { name: "Total Grants", type: "number", format: "dollar" },
      { name: "Source URL", type: "url" },
    ],
  },
  {
    key: "opportunities",
    name: "Opportunities",
    description: "Grant opportunities with fit, effort, evidence coverage, and priority.",
    icon: "🎯",
    properties: [
      { name: "Opportunity Name", type: "title" },
      { name: "Funder", type: "relation", dataSourceKey: "funders" },
      { name: "Funder Name", type: "rich_text" },
      { name: "Status", type: "select", options: opportunityStatusOptions },
      { name: "Deadline", type: "date" },
      { name: "Submission Platform", type: "select", options: submissionMethodOptions },
      { name: "Fit Score", type: "number", format: "percent" },
      { name: "Pursue Decision", type: "select", options: pursueDecisionOptions },
      { name: "Evidence Coverage %", type: "number", format: "percent" },
      { name: "Effort Hours", type: "number" },
      { name: "Reporting Burden Score", type: "number" },
      { name: "Priority Score", type: "number" },
      { name: "Next Best Action", type: "rich_text" },
      { name: "Source URL", type: "url" },
      { name: "Portal URL", type: "url" },
    ],
  },
  {
    key: "requirements",
    name: "Requirements",
    description: "One record per prompt, attachment, or submission requirement.",
    icon: "🧩",
    properties: [
      { name: "Requirement", type: "title" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Opportunity Name", type: "rich_text" },
      { name: "Requirement Type", type: "select", options: requirementTypeOptions },
      { name: "Required", type: "checkbox" },
      { name: "Word Limit", type: "number" },
      { name: "Coverage Status", type: "select", options: coverageStatusOptions },
      { name: "Risk Level", type: "select", options: riskOptions },
      { name: "Risk Flag", type: "rich_text" },
      { name: "Reviewer Notes", type: "rich_text" },
    ],
  },
  {
    key: "evidence-library",
    name: "Evidence Library",
    description: "Reusable evidence snippets, outcomes, metrics, and supporting proof.",
    icon: "🔎",
    properties: [
      { name: "Evidence Title", type: "title" },
      { name: "Program", type: "relation", dataSourceKey: "programs" },
      { name: "Evidence Type", type: "select", options: evidenceTypeOptions },
      { name: "Summary", type: "rich_text" },
      { name: "Metrics", type: "rich_text" },
      { name: "Geography", type: "rich_text" },
      { name: "Source Document", type: "rich_text" },
      { name: "Quality Score", type: "number", format: "percent" },
      { name: "Reusability Score", type: "select", options: reusabilityOptions },
      { name: "Collected At", type: "date" },
      { name: "Tags", type: "multi_select", options: evidenceTagOptions },
    ],
  },
  {
    key: "documents",
    name: "Documents",
    description: "Reusable documents like 501(c)(3), board lists, budgets, and audits.",
    icon: "📂",
    properties: [
      { name: "Document Name", type: "title" },
      { name: "Organization", type: "relation", dataSourceKey: "organization" },
      { name: "Category", type: "select", options: documentCategoryOptions },
      { name: "Upload Status", type: "select", options: uploadStatusOptions },
      { name: "Expiration Date", type: "date" },
      { name: "Owner", type: "rich_text" },
      { name: "File URL", type: "url" },
    ],
  },
  {
    key: "budgets",
    name: "Budgets",
    description: "Program and organizational budgets used in proposals and reports.",
    icon: "💵",
    properties: [
      { name: "Budget Name", type: "title" },
      { name: "Program", type: "relation", dataSourceKey: "programs" },
      { name: "Fiscal Year", type: "number" },
      { name: "Budget Type", type: "select", options: budgetTypeOptions },
      { name: "Total Revenue", type: "number", format: "dollar" },
      { name: "Total Expense", type: "number", format: "dollar" },
      { name: "Notes", type: "rich_text" },
    ],
  },
  {
    key: "draft-answers",
    name: "Draft Answers",
    description: "Grounded answers, evidence refs, unsupported claims, and DNA alignment.",
    icon: "✍️",
    properties: [
      { name: "Draft Name", type: "title" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Requirement", type: "relation", dataSourceKey: "requirements" },
      { name: "Evidence", type: "relation", dataSourceKey: "evidence-library" },
      { name: "Status", type: "select", options: draftStatusOptions },
      { name: "Draft Text", type: "rich_text" },
      { name: "Evidence Citations", type: "rich_text" },
      { name: "DNA Match %", type: "number", format: "percent" },
      { name: "Unsupported Claims", type: "checkbox" },
      { name: "Reviewer Notes", type: "rich_text" },
    ],
  },
  {
    key: "tasks",
    name: "Tasks",
    description: "Execution layer for missing evidence, reviews, approvals, and reporting tasks.",
    icon: "✅",
    properties: [
      { name: "Task", type: "title" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Requirement", type: "relation", dataSourceKey: "requirements" },
      { name: "Priority", type: "select", options: priorityOptions },
      { name: "Status", type: "select", options: taskStatusOptions },
      { name: "Due Date", type: "date" },
      { name: "Assignee", type: "rich_text" },
      { name: "Blocking", type: "checkbox" },
    ],
  },
  {
    key: "reviews-approvals",
    name: "Reviews / Approvals",
    description: "Human-in-the-loop checkpoints before sensitive draft and submission actions.",
    icon: "🧑‍⚖️",
    properties: [
      { name: "Review", type: "title" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Draft Answer", type: "relation", dataSourceKey: "draft-answers" },
      { name: "Review Type", type: "select", options: reviewTypeOptions },
      { name: "Status", type: "select", options: reviewStatusOptions },
      { name: "Reviewer", type: "rich_text" },
      { name: "Requested On", type: "date" },
      { name: "Approved On", type: "date" },
    ],
  },
  {
    key: "submissions",
    name: "Submissions",
    description: "Portal state, packet completeness, and final submission records.",
    icon: "🚀",
    properties: [
      { name: "Submission", type: "title" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Method", type: "select", options: submissionMethodOptions },
      { name: "Ready Status", type: "select", options: submissionReadyOptions },
      { name: "Submitted On", type: "date" },
      { name: "Portal Reference", type: "rich_text" },
      { name: "Portal URL", type: "url" },
    ],
  },
  {
    key: "reporting-calendar",
    name: "Reporting Calendar",
    description: "Post-award deadlines, owners, templates, and promised metrics.",
    icon: "📅",
    properties: [
      { name: "Report", type: "title" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Opportunity Name", type: "rich_text" },
      { name: "Due Date", type: "date" },
      { name: "Status", type: "select", options: reportStatusOptions },
      { name: "Owner", type: "rich_text" },
      { name: "Reporting Period", type: "rich_text" },
      { name: "Required Metrics", type: "rich_text" },
      { name: "Template Link", type: "url" },
    ],
  },
  {
    key: "lessons-rejections",
    name: "Lessons / Rejections",
    description: "Rejection feedback, lessons learned, and next-cycle recommendations.",
    icon: "🧠",
    properties: [
      { name: "Lesson", type: "title" },
      { name: "Funder", type: "relation", dataSourceKey: "funders" },
      { name: "Opportunity", type: "relation", dataSourceKey: "opportunities" },
      { name: "Funder Name", type: "rich_text" },
      { name: "Result", type: "select", options: lessonResultOptions },
      { name: "Feedback Text", type: "rich_text" },
      { name: "Themes", type: "multi_select", options: rejectionThemeOptions },
      { name: "Recommendations", type: "rich_text" },
      { name: "Applies Next Cycle", type: "checkbox" },
    ],
  },
  {
    key: "funder-contrasts",
    name: "Funder Contrasts",
    description:
      "Side-by-side 990 intelligence comparisons that make funder differences obvious in demos and planning.",
    icon: "⚖️",
    properties: [
      { name: "Contrast", type: "title" },
      { name: "Left Funder", type: "rich_text" },
      { name: "Right Funder", type: "rich_text" },
      { name: "Left Grant Signal", type: "rich_text" },
      { name: "Right Grant Signal", type: "rich_text" },
      { name: "Primary Difference", type: "rich_text" },
      { name: "Contrast Summary", type: "rich_text" },
      { name: "Recommended Move", type: "rich_text" },
    ],
  },
  {
    key: "agent-logs",
    name: "Agent Logs",
    description: "Audit trail of intake, scoring, drafting, and compliance actions.",
    icon: "📜",
    properties: [
      { name: "Log Entry", type: "title" },
      { name: "Run ID", type: "rich_text" },
      { name: "Timestamp", type: "date" },
      { name: "Agent", type: "select", options: agentOptions },
      { name: "Action", type: "rich_text" },
      { name: "Source", type: "rich_text" },
      { name: "Confidence", type: "select", options: agentConfidenceOptions },
      { name: "Confidence %", type: "number", format: "percent" },
      { name: "Source URL", type: "url" },
      { name: "Follow-Up Required", type: "checkbox" },
      { name: "Output Summary", type: "rich_text" },
      { name: "Summary", type: "rich_text" },
    ],
  },
];
