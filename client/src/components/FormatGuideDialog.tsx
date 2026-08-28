import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";

const MAC_MAN_URL = "/docs/mac-man.txt";

export function FormatGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || text || error) return;
    void fetch(MAC_MAN_URL)
      .then((response) => {
        if (!response.ok) throw new Error("MAC.MAN not found");
        return response.text();
      })
      .then(setText)
      .catch(() => setError("MAC.MAN を読み込めませんでした。"));
  }, [error, open, text]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="format-guide-dialog"
        className="max-h-[92vh] max-w-[min(960px,96vw)] gap-0 overflow-hidden border border-white/15 bg-[#11120f] p-0 text-[#dfe1d8] sm:max-w-[min(960px,96vw)]"
      >
        <DialogHeader className="border-b border-white/10 px-4 py-4 sm:px-5">
          <DialogTitle className="mono text-sm uppercase tracking-[0.14em] text-[#f5f4ec]">Format guide · MAC.MAN</DialogTitle>
          <DialogDescription className="mono mb-0 text-[10px] leading-5 text-[#a9aca2]">
            MADRV MUSIC CONVERTER（MAC.X）マニュアル。MDR / MDX / MML のコンパイル仕様です。ブラウザ内 MML エディタは簡易サブセットのみ対応します。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[min(72vh,720px)]">
          <pre
            data-testid="format-guide-body"
            className="mono m-0 whitespace-pre-wrap p-4 text-[10px] leading-5 text-[#dfe1d8] sm:p-5"
          >
            {error ?? text ?? "MAC.MAN を読み込み中…"}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
