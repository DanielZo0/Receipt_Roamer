import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { ExternalLink, Loader2, Pencil, Save, X } from "lucide-react";

/**
 * The icon group shared by the income table row and the income mobile card.
 *
 * Read mode: edit / open-file / delete.
 * Edit mode: cancel / save — the destructive action is deliberately out of
 * reach while a draft is open.
 */
export function PaymentActions({
  isEditing,
  saving,
  filePath,
  deleteDescription,
  onEdit,
  onCancel,
  onSave,
  onOpenFile,
  onDelete,
}: {
  isEditing: boolean;
  saving: boolean;
  filePath: string | null;
  deleteDescription: ReactNode;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onOpenFile: () => void;
  onDelete: () => void;
}) {
  if (isEditing) {
    return (
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" onClick={onCancel} disabled={saving} title="Cancel">
          <X className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onSave} disabled={saving} title="Save">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" onClick={onEdit} title="Edit">
        <Pencil className="h-4 w-4" />
      </Button>
      {filePath && (
        <Button size="icon" variant="ghost" onClick={onOpenFile} title="Open file">
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}
      <ConfirmDeleteButton
        title="Delete this payment?"
        description={deleteDescription}
        onConfirm={onDelete}
      />
    </div>
  );
}
