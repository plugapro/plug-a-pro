export type ReviewDimensionKey =
  | "communication"
  | "quote_clarity"
  | "arrival_reliability"
  | "work_record"
  | "site_respect";

export type ReviewDimension = {
  key: ReviewDimensionKey;
  label: string;
  description: string;
};

export const reviewModelContent = {
  title: "Real reviews after completed jobs",
  intro:
    "Reviews belong to completed Plug A Pro jobs. They are tied to the job record so provider reputation grows from actual work, not profile claims.",
  dimensions: [
    {
      key: "communication",
      label: "Communication",
      description: "Clear updates before, during and after the job.",
    },
    {
      key: "quote_clarity",
      label: "Quote clarity",
      description: "Price, scope and extra work requests written clearly.",
    },
    {
      key: "arrival_reliability",
      label: "Arrival reliability",
      description: "Arrived when agreed or kept the customer updated.",
    },
    {
      key: "work_record",
      label: "Job record",
      description: "Photos, notes and completion updates added where appropriate.",
    },
    {
      key: "site_respect",
      label: "Site respect",
      description: "Respectful conduct and tidy close-out on site.",
    },
  ] satisfies ReviewDimension[],
};
