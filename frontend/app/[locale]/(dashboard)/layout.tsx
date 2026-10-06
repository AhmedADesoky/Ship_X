import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { FlowTrailBar } from "@/components/layout/flow-trail-bar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { FlowTrailProvider } from "@/lib/flow-trail";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <FlowTrailProvider>
        <SidebarProvider className="gap-3 bg-muted/60 p-3 print:bg-white print:p-0 print:gap-0">
          <div className="print:hidden">
            <AppSidebar />
          </div>
          <SidebarInset className="bg-transparent print:bg-white">
            <div className="print:hidden">
              <AppHeader />
              <FlowTrailBar />
            </div>
            <main className="flex-1 p-4 sm:p-6 print:p-0">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </FlowTrailProvider>
    </AuthGuard>
  );
}
