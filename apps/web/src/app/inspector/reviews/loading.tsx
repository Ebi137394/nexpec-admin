// app/inspector/reviews/loading.tsx — segment loading state.
export default function InspectorReviewsLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div
        role="status"
        aria-label="Loading assigned reviews"
        className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"
      />
    </div>
  );
}
