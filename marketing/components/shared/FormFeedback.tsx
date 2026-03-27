interface FormFeedbackProps {
  status: "idle" | "loading" | "success" | "error";
  successMessage?: string;
  errorMessage?: string;
}

export function FormFeedback({
  status,
  successMessage = "Submitted!",
  errorMessage = "Something went wrong. Please try again.",
}: FormFeedbackProps) {
  if (status === "idle") return null;
  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">Submitting...</p>;
  }
  if (status === "success") {
    return <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>;
  }
  return <p className="text-sm text-destructive">{errorMessage}</p>;
}
