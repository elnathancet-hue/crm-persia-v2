"use client";

import * as React from "react";
import { Button } from "@persia/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";
import { useRouter } from "next/navigation";
import { deleteAppointmentType } from "@/actions/appointment-types";

export function AppointmentDeleteButton({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Excluir
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tipo de agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA não conseguirá mais usar este tipo. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteAppointmentType(id);
                router.refresh();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
