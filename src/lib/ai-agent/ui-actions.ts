// Registry of "show me" UI actions the AI assistant can guide a user to.
// route: where to navigate (null = stay on the current page, e.g. a sidebar modal).
// target: the data-ai-target value of the button to highlight (optional).
// triggers: lowercase phrases in the user's question that map to this action.
// Navigation always works; the highlight is a bonus when the target is tagged.

export type UiActionId =
  | "add-warehouse"
  | "add-driver"
  | "create-route"
  | "import-csv"
  | "run-plan"
  | "create-case"
  | "add-profile";

export type Guidance = {
  id: UiActionId;
  label: string;
  route: string | null;
  target: string | null;
};

type UiAction = Guidance & { triggers: string[] };

export const UI_ACTIONS: UiAction[] = [
  {
    id: "add-warehouse",
    label: "Add a warehouse",
    route: "/warehouses",
    target: "add-warehouse",
    triggers: ["add a warehouse", "add warehouse", "new warehouse", "create a warehouse", "create warehouse"],
  },
  {
    id: "add-driver",
    label: "Add a driver",
    route: "/drivers",
    target: "add-driver",
    triggers: ["add a driver", "add driver", "new driver", "create a driver", "add a new driver"],
  },
  {
    id: "create-route",
    label: "Create a route",
    route: "/dispatch",
    target: "create-route",
    triggers: ["create a route", "create route", "new route", "add a route", "create a vrid"],
  },
  {
    id: "import-csv",
    label: "Import routes from CSV",
    route: "/dispatch",
    target: "import-csv",
    triggers: ["import csv", "import routes", "upload csv", "bulk import", "import a csv"],
  },
  {
    id: "run-plan",
    label: "Run the plan",
    route: "/dispatch",
    target: "run-plan",
    triggers: ["run the plan", "run planning", "run the planning", "run today's plan"],
  },
  {
    id: "create-case",
    label: "Create a support case",
    route: null,
    target: "create-case",
    triggers: ["create a case", "raise a ticket", "report a problem", "report a bug", "contact support", "support case", "open a ticket"],
  },
  {
    id: "add-profile",
    label: "Add a team member",
    route: "/team",
    target: "add-profile",
    triggers: ["add a profile", "create a user", "add a user", "add a member", "create a profile", "add a team member", "new user", "add a new user"],
  },
];

// Deterministic phrase match — reliable, and avoids depending on the LLM to
// emit correct selectors. Returns the first matching action, or null.
export function matchUiAction(message: string): Guidance | null {
  const m = message.toLowerCase();
  for (const a of UI_ACTIONS) {
    if (a.triggers.some((t) => m.includes(t))) {
      return { id: a.id, label: a.label, route: a.route, target: a.target };
    }
  }
  return null;
}
