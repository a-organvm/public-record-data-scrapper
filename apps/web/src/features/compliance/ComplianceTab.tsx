import { Tabs, TabsContent, TabsList, TabsTrigger } from '@public-records/ui/tabs'
import { DisclosureManager, ConsentDashboard, AuditLogViewer } from '@/components/compliance'

// Compliance has no REST client or server route yet, so each surface renders
// its genuine empty state against an empty backend. The three controlled
// components are grouped under sub-tabs; no mock data is injected.
export function ComplianceTab() {
  return (
    <Tabs defaultValue="disclosures" className="w-full">
      <TabsList className="glass-effect mb-4 sm:mb-6">
        <TabsTrigger value="disclosures">Disclosures</TabsTrigger>
        <TabsTrigger value="consent">Consent</TabsTrigger>
        <TabsTrigger value="audit">Audit Log</TabsTrigger>
      </TabsList>

      <TabsContent value="disclosures">
        <DisclosureManager
          disclosures={[]}
          deals={[]}
          onGenerateDisclosure={() => {}}
          onSendDisclosure={() => {}}
          onDownloadDisclosure={() => {}}
          onPreviewDisclosure={() => {}}
        />
      </TabsContent>

      <TabsContent value="consent">
        <ConsentDashboard
          consents={[]}
          contacts={[]}
          onRecordConsent={() => {}}
          onRevokeConsent={() => {}}
        />
      </TabsContent>

      <TabsContent value="audit">
        <AuditLogViewer auditLogs={[]} onExport={() => {}} />
      </TabsContent>
    </Tabs>
  )
}
