import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Phone, Edit, Trash2, Briefcase, Calendar, User, Car, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

type TechnicianStatus = "Active" | "On Leave" | "Inactive";

type Technician = {
  id: number;
  name: string;
  phone: string | null;
  status: TechnicianStatus;
};

type TechnicianJob = {
  id: number;
  customer_id: number;
  customer_name: string | null;
  vehicle_id: number | null;
  vehicle_name: string | null;
  job_status: string;
  category: string | null;
  description: string | null;
  notes: string | null;
  initial_amount: number | null;
  advance_amount: number | null;
  mileage: number | null;
  created_at: string;
};

type UpsertTechnicianPayload = {
  name: string;
  phone?: string;
  status?: TechnicianStatus;
};

const TECHNICIAN_STATUSES: TechnicianStatus[] = ["Active", "On Leave", "Inactive"];
const STATUS_BADGE_STYLES: Record<TechnicianStatus, string> = {
  Active: "bg-success text-success-foreground",
  "On Leave": "bg-warning text-warning-foreground",
  Inactive: "bg-muted text-muted-foreground",
};

const TECHNICIANS_QUERY_KEY = ["technicians"];

const Technicians = () => {
  const [addOpen, setAddOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTech, setSelectedTech] = useState<Technician | null>(null);
  const [createStatus, setCreateStatus] = useState<TechnicianStatus>("Active");
  const [editStatus, setEditStatus] = useState<TechnicianStatus>("Active");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: techniciansData,
    isLoading: techniciansLoading,
    isError: techniciansError,
    error: techniciansErrorObject,
  } = useQuery<Technician[], Error>({
    queryKey: TECHNICIANS_QUERY_KEY,
    queryFn: () => apiFetch<Technician[]>("/technicians"),
  });

  const technicians = techniciansData ?? [];

  const {
    data: jobCounts,
    isLoading: jobCountsLoading,
  } = useQuery<Record<number, number>>({
    queryKey: [...TECHNICIANS_QUERY_KEY, "job-counts", technicians.map((tech) => tech.id)],
    queryFn: async () => {
      const results = await Promise.all(
        technicians.map(async (tech) => {
          const jobs = await apiFetch<TechnicianJob[]>(`/technicians/${tech.id}/jobs`);
          return [tech.id, jobs.length] as const;
        })
      );
      return Object.fromEntries(results);
    },
    enabled: technicians.length > 0,
  });

  const derivedTechnicians = useMemo(() => technicians, [technicians]);

  useEffect(() => {
    if (selectedTech) {
      setEditStatus(selectedTech.status);
    }
  }, [selectedTech]);

  const createTechnicianMutation = useMutation<Technician, Error, UpsertTechnicianPayload>({
    mutationFn: (payload) =>
      apiFetch<Technician>("/technicians", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (technician) => {
      queryClient.invalidateQueries({ queryKey: TECHNICIANS_QUERY_KEY });
      toast({
        title: "Technician added",
        description: `${technician.name} has been added to the team.`,
      });
      setCreateStatus("Active");
      setAddOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Unable to add technician",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateTechnicianMutation = useMutation<
    Technician,
    Error,
    { id: number; payload: UpsertTechnicianPayload }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<Technician>(`/technicians/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (technician) => {
      queryClient.invalidateQueries({ queryKey: TECHNICIANS_QUERY_KEY });
      toast({
        title: "Technician updated",
        description: `${technician.name} has been updated successfully.`,
      });
      setSelectedTech(technician);
      setEditOpen(false);
      setDetailOpen(true);
    },
    onError: (error) => {
      toast({
        title: "Unable to update technician",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteTechnicianMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/technicians/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: TECHNICIANS_QUERY_KEY });
      toast({
        title: "Technician deleted",
        description: `Technician #${id} has been removed.`,
      });
      setDeleteOpen(false);
      setDetailOpen(false);
      setSelectedTech(null);
    },
    onError: (error) => {
      toast({
        title: "Unable to delete technician",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateTechnician = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").trim();

    if (!name) {
      toast({
        title: "Technician name is required",
        description: "Please provide a name before adding the technician.",
        variant: "destructive",
      });
      return;
    }

    const payload: UpsertTechnicianPayload = {
      name,
      phone: phone || undefined,
      status: createStatus,
    };

    createTechnicianMutation.mutate(payload, {
      onSuccess: () => {
        form.reset();
      },
    });
  };

  const handleUpdateTechnician = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTech) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const payload: UpsertTechnicianPayload = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim() || undefined,
      status: editStatus,
    };

    if (!payload.name) {
      toast({
        title: "Technician name is required",
        description: "Please provide a name before saving changes.",
        variant: "destructive",
      });
      return;
    }

    updateTechnicianMutation.mutate(
      { id: selectedTech.id, payload },
      {
        onSuccess: () => {
          form.reset();
        },
      }
    );
  };

  const jobsForTechnician = (id: number) => jobCounts?.[id] ?? 0;

  // Fetch detailed jobs for selected technician
  const {
    data: technicianJobs,
    isLoading: technicianJobsLoading,
    isError: technicianJobsError,
  } = useQuery<TechnicianJob[]>({
    queryKey: [...TECHNICIANS_QUERY_KEY, "jobs", selectedTech?.id],
    queryFn: () => apiFetch<TechnicianJob[]>(`/technicians/${selectedTech?.id}/jobs?include_completed=true`),
    enabled: Boolean(selectedTech?.id) && detailOpen,
  });

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "LKR",
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return value;
    const adjusted = new Date(parsed.getTime() + 5.5 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(adjusted);
  };

  const formatVehicle = (job: TechnicianJob) => {
    if (job.vehicle_name) return job.vehicle_name;
    return "—";
  };

  const getJobStatusBadge = (status: string) => {
    const normalized = status?.toLowerCase();
    switch (normalized) {
      case "completed":
        return { label: "Completed", className: "bg-success text-success-foreground" };
      case "in progress":
        return { label: "In Progress", className: "bg-primary text-primary-foreground" };
      case "pending":
        return { label: "Pending", className: "bg-warning text-warning-foreground" };
      case "cancelled":
        return { label: "Cancelled", className: "bg-destructive text-destructive-foreground" };
      default:
        return { label: status || "Unknown", className: "bg-muted text-muted-foreground" };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Technicians</h1>
          <p className="text-muted-foreground">Manage your garage technicians</p>
        </div>
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) {
              setCreateStatus("Active");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" />
              Add Technician
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Technician</DialogTitle>
              <DialogDescription>Add a new technician to your garage team</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateTechnician} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" name="name" placeholder="Full Name" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" name="phone" type="tel" placeholder="555-0101" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={createStatus}
                  onValueChange={(value) => setCreateStatus(value as TechnicianStatus)}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TECHNICIAN_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-primary"
                  disabled={createTechnicianMutation.isPending}
                >
                  {createTechnicianMutation.isPending ? "Adding..." : "Add Technician"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {techniciansLoading && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Loading technicians...
        </div>
      )}

      {techniciansError && !techniciansLoading && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {techniciansErrorObject?.message ?? "Failed to load technicians."}
        </div>
      )}

      {!techniciansLoading && !techniciansError && derivedTechnicians.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No technicians found. Start by adding one.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {derivedTechnicians.map((tech) => {
          const jobsCount = jobsForTechnician(tech.id);
          const statusLabel = tech.status;
          const statusClass =
            STATUS_BADGE_STYLES[statusLabel] ?? "bg-muted text-muted-foreground";

          return (
            <Card
              key={tech.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => {
                setSelectedTech(tech);
                setDetailOpen(true);
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {tech.name
                          .split(" ")
                          .map((chunk) => chunk[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold">{tech.name}</h3>
                      <Badge className={statusClass}>
                        {statusLabel}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  {tech.phone || "Not provided"}
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">Assigned Jobs</p>
                  <p className="text-2xl font-bold text-foreground">
                    {jobCountsLoading ? "…" : jobsCount}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Technician Detail Modal */}
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open && !editOpen && !deleteOpen) {
            setSelectedTech(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Technician Details</DialogTitle>
            <DialogDescription>
              Complete information and assigned jobs for {selectedTech?.name ?? "technician"}
            </DialogDescription>
          </DialogHeader>
          {selectedTech && (
            <div className="space-y-6">
              {/* Technician Information */}
              <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/20 p-4">
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Full Name</Label>
                  <p className="font-semibold text-lg mt-1">{selectedTech.name}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge
                      className={
                        STATUS_BADGE_STYLES[selectedTech.status] ??
                        "bg-muted text-muted-foreground"
                      }
                    >
                      {selectedTech.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Phone</Label>
                  <p className="font-semibold mt-1">{selectedTech.phone || "Not provided"}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Total Assigned Jobs</Label>
                  <p className="font-semibold text-2xl mt-1">
                    {jobCountsLoading ? "…" : jobsForTechnician(selectedTech.id)}
                  </p>
                </div>
              </div>

              {/* Assigned Jobs Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Assigned Jobs</h3>
                  </div>
                  {technicianJobs && technicianJobs.length > 0 && (
                    <Badge variant="outline" className="text-sm">
                      {technicianJobs.length} job{technicianJobs.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                {technicianJobsLoading && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Loading jobs...
                  </div>
                )}

                {technicianJobsError && !technicianJobsLoading && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-6 text-center text-sm text-destructive">
                    Failed to load jobs. Please try again.
                  </div>
                )}

                {!technicianJobsLoading && !technicianJobsError && (!technicianJobs || technicianJobs.length === 0) && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No jobs assigned to this technician.
                  </div>
                )}

                {!technicianJobsLoading && !technicianJobsError && technicianJobs && technicianJobs.length > 0 && (
                  <div className="rounded-md border">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                          <tr>
                            <th className="p-3 font-medium">Job ID</th>
                            <th className="p-3 font-medium">Customer</th>
                            <th className="p-3 font-medium">Vehicle</th>
                            <th className="p-3 font-medium">Description</th>
                            <th className="p-3 font-medium">Status</th>
                            <th className="p-3 font-medium">Category</th>
                            <th className="p-3 font-medium text-right">Amount</th>
                            <th className="p-3 font-medium">Date</th>
                            <th className="p-3 font-medium text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {technicianJobs.map((job, index) => {
                            const statusMeta = getJobStatusBadge(job.job_status);
                            return (
                              <tr
                                key={job.id}
                                className={`border-b transition-colors ${
                                  index % 2 === 0 ? "bg-background" : "bg-muted/20"
                                } hover:bg-muted/50`}
                              >
                                <td className="p-3 font-semibold">#{job.id}</td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2 min-w-[120px]">
                                    <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate" title={job.customer_name || `Customer #${job.customer_id}`}>
                                      {job.customer_name || `Customer #${job.customer_id}`}
                                    </span>
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2 min-w-[100px]">
                                    <Car className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <span className="text-muted-foreground truncate" title={formatVehicle(job)}>
                                      {formatVehicle(job)}
                                    </span>
                                  </div>
                                </td>
                                <td className="p-3">
                                  <span className="max-w-[180px] truncate block" title={job.description || "—"}>
                                    {job.description || "—"}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                                </td>
                                <td className="p-3 text-muted-foreground">
                                  {job.category || "—"}
                                </td>
                                <td className="p-3 text-right font-semibold">
                                  {formatCurrency(job.initial_amount)}
                                </td>
                                <td className="p-3 text-muted-foreground whitespace-nowrap">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3 flex-shrink-0" />
                                    <span className="text-xs">{formatDate(job.created_at)}</span>
                                  </div>
                                </td>
                                <td className="p-3 text-center">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate("/jobs", { state: { jobId: job.id } });
                                    }}
                                    className="h-8"
                                  >
                                    <ExternalLink className="h-3 w-3 mr-1" />
                                    View
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Job Statistics */}
                {!technicianJobsLoading && !technicianJobsError && technicianJobs && technicianJobs.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-4 rounded-md border bg-muted/10 p-4">
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Total Jobs</Label>
                      <p className="font-semibold text-xl mt-1">{technicianJobs.length}</p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">In Progress</Label>
                      <p className="font-semibold text-xl mt-1 text-primary">
                        {technicianJobs.filter((j) => j.job_status === "In Progress").length}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Pending</Label>
                      <p className="font-semibold text-xl mt-1 text-warning">
                        {technicianJobs.filter((j) => j.job_status === "Pending").length}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Completed</Label>
                      <p className="font-semibold text-xl mt-1 text-success">
                        {technicianJobs.filter((j) => j.job_status === "Completed").length}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setDetailOpen(false);
                    setEditOpen(true);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    setDetailOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Technician Modal */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open && !detailOpen && !deleteOpen) {
            setSelectedTech(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Technician</DialogTitle>
            <DialogDescription>
              Update technician details for {selectedTech?.name ?? "technician"}
            </DialogDescription>
          </DialogHeader>
          {selectedTech && (
            <form onSubmit={handleUpdateTechnician} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="editName">Full Name</Label>
                <Input
                  id="editName"
                  name="name"
                  defaultValue={selectedTech.name}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editPhone">Phone Number</Label>
                <Input
                  id="editPhone"
                  name="phone"
                  type="tel"
                  defaultValue={selectedTech.phone ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editStatus">Status</Label>
                <Select
                  value={editStatus}
                  onValueChange={(value) => setEditStatus(value as TechnicianStatus)}
                >
                  <SelectTrigger id="editStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TECHNICIAN_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-primary"
                  disabled={updateTechnicianMutation.isPending}
                >
                  {updateTechnicianMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open && !detailOpen && !editOpen) {
            setSelectedTech(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedTech?.name ?? "this technician"}? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTechnicianMutation.isPending}
              onClick={() => {
                if (!selectedTech) return;
                deleteTechnicianMutation.mutate(selectedTech.id);
              }}
            >
              {deleteTechnicianMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Technicians;
