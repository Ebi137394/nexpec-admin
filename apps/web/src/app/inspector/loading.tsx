// app/inspector/loading.tsx — segment loading state while server components stream.
export default function InspectorLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div
        aria-label="Loading"
        className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"
      />
    </div>
  );
}
