import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { formatISTDateTime } from "@/lib/time";

type JobStatus = "Pending" | "In Progress" | "Completed" | "Cancelled";

type Customer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
};

type Vehicle = {
  id: number;
  customer_id: number;
  make: string | null;
  model: string | null;
  year: string | null;
  license_plate: string | null;
};

type TechnicianStatus = "Active" | "On Leave" | "Inactive";

type Technician = {
  id: number;
  name: string;
  status: TechnicianStatus;
  phone?: string | null;
};

type JobSummary = {
  id: number;
  customer_id: number;
  customer_name: string | null;
  vehicle_id: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_license_plate: string | null;
  job_status: JobStatus;
  category: string | null;
  description: string | null;
  notes: string | null;
  initial_amount: number | null;
  advance_amount: number | null;
  mileage: number | null;
  created_at: string;
  technicians: Array<{
    id: number;
    name: string;
    status: TechnicianStatus;
  }>;
  invoice_created?: number;
};

type JobItemDetail = {
  id: number;
  job_id: number;
  inventory_item_id: number | null;
  item_name: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type JobInvoiceSummary = {
  id: number;
  invoice_no: string | null;
  final_total: number | null;
  payment_status: string;
};

type JobDetail = JobSummary & {
  items?: JobItemDetail[];
  invoice?: JobInvoiceSummary | null;
};

type CreateJobPayload = {
  customer_id: number;
  description: string;
  category?: string | null;
  notes?: string | null;
  vehicle_id?: number;
  vehicle?: {
    make: string;
    model: string;
    year?: string | null;
    license_plate?: string | null;
  };
  technician_ids?: number[];
  job_status?: JobStatus;
  initial_amount?: number | null;
  advance_amount?: number | null;
  mileage?: number | null;
};

const JOB_STATUS_OPTIONS: JobStatus[] = ["Pending", "In Progress", "Completed", "Cancelled"];

const JOB_CATEGORY_OPTIONS = [
  "Maintenance",
  "Repair",
  "Diagnostics",
  "Inspection",
  "Detailing",
  "Other",
] as const;

const STATUS_BADGE_STYLES: Record<JobStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  "In Progress": "bg-warning text-warning-foreground",
  Completed: "bg-success text-success-foreground",
  Cancelled: "bg-destructive text-destructive-foreground",
};

const JOBS_QUERY_KEY = ["jobs"];
const CUSTOMERS_QUERY_KEY = ["customers"];
const TECHNICIANS_QUERY_KEY = ["technicians"];
const VEHICLES_QUERY_KEY = ["vehicles"];

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatVehicle = (job: JobSummary) => {
  const makeModel = [job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ");
  const year = job.vehicle_year ? ` ${job.vehicle_year}` : "";
  const license = job.vehicle_license_plate ? ` • ${job.vehicle_license_plate}` : "";
  return makeModel ? `${makeModel}${year}${license}`.trim() : "—";
};

const formatDateTime = (value: string | null | undefined) => formatISTDateTime(value);

const Jobs = () => {
  const [createOpen, setCreateOpen] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [vehicleSelectOpen, setVehicleSelectOpen] = useState(false);
  const [jobDetailOpen, setJobDetailOpen] = useState(false);
  const [jobEditOpen, setJobEditOpen] = useState(false);
  const [jobDeleteOpen, setJobDeleteOpen] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehiclePromptAcknowledged, setVehiclePromptAcknowledged] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobSummary | null>(null);
  const [selectedJobDetail, setSelectedJobDetail] = useState<JobDetail | null>(null);
  const [jobDetailLoading, setJobDetailLoading] = useState(false);
  const [editTechnicians, setEditTechnicians] = useState<number[]>([]);

  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleLicensePlate, setVehicleLicensePlate] = useState("");

  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [initialAmount, setInitialAmount] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [mileage, setMileage] = useState("");
  const [mileageUnit, setMileageUnit] = useState<"km" | "mi">("km");
  const [jobStatus, setJobStatus] = useState<JobStatus>("Pending");
  const [jobCategory, setJobCategory] = useState<string>(JOB_CATEGORY_OPTIONS[0]);
  const [assignedTechnicians, setAssignedTechnicians] = useState<number[]>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: customersData,
    isLoading: customersLoading,
    isError: customersError,
    error: customersErrorObject,
  } = useQuery<Customer[], Error>({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: () => apiFetch<Customer[]>("/customers"),
  });

  const {
    data: techniciansData,
    isLoading: techniciansLoading,
    isError: techniciansError,
    error: techniciansErrorObject,
  } = useQuery<Technician[], Error>({
    queryKey: TECHNICIANS_QUERY_KEY,
    queryFn: () => apiFetch<Technician[]>("/technicians"),
  });

  const {
    data: jobsData,
    isLoading: jobsLoading,
    isError: jobsError,
    error: jobsErrorObject,
  } = useQuery<JobSummary[], Error>({
    queryKey: JOBS_QUERY_KEY,
    queryFn: () => apiFetch<JobSummary[]>("/jobs"),
  });

  const {
    data: customerVehicles,
    isFetching: vehiclesLoading,
    isError: vehiclesError,
    error: vehiclesErrorObject,
  } = useQuery<Vehicle[], Error>({
    queryKey: [...VEHICLES_QUERY_KEY, selectedCustomer?.id ?? "none"],
    queryFn: () => apiFetch<Vehicle[]>(`/vehicles?customer_id=${selectedCustomer?.id}`),
    enabled: Boolean(selectedCustomer),
  });

  const customers = customersData ?? [];
  const technicians = (techniciansData ?? []).filter((tech) => tech.status !== "Inactive");
  const jobs = jobsData ?? [];
  const vehiclesForCustomer = customerVehicles ?? [];

  const resetVehicleState = () => {
    setSelectedVehicle(null);
    setVehicleMake("");
    setVehicleModel("");
    setVehicleYear("");
    setVehicleLicensePlate("");
  };

  const resetForm = () => {
    setSelectedCustomer(null);
    setCustomerPickerOpen(false);
    resetVehicleState();
    setVehiclePromptAcknowledged(false);
    setDescription("");
    setNotes("");
    setInitialAmount("");
    setAdvanceAmount("");
    setMileage("");
    setJobStatus("Pending");
    setJobCategory(JOB_CATEGORY_OPTIONS[0]);
    setAssignedTechnicians([]);
  };

  const applyVehicleSelection = (vehicle: Vehicle | null) => {
    setSelectedVehicle(vehicle);
    if (vehicle) {
      setVehicleMake(vehicle.make ?? "");
      setVehicleModel(vehicle.model ?? "");
      setVehicleYear(vehicle.year ?? "");
      setVehicleLicensePlate(vehicle.license_plate ?? "");
    } else {
      setVehicleMake("");
      setVehicleModel("");
      setVehicleYear("");
      setVehicleLicensePlate("");
    }
  };

  useEffect(() => {
    if (!selectedCustomer) {
      resetVehicleState();
      setVehiclePromptAcknowledged(false);
      return;
    }
    setVehiclePromptAcknowledged(false);
    applyVehicleSelection(null);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    if (
      !createOpen ||
      !selectedCustomer ||
      vehiclePromptAcknowledged ||
      !vehiclesForCustomer.length
    ) {
      return;
    }
    setVehicleSelectOpen(true);
  }, [createOpen, selectedCustomer?.id, vehiclePromptAcknowledged, vehiclesForCustomer.length]);

  const toggleTechnician = (id: number, checked: boolean) => {
    setAssignedTechnicians((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((techId) => techId !== id);
    });
  };

  const toggleEditTechnician = (id: number, checked: boolean) => {
    setEditTechnicians((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((techId) => techId !== id);
    });
  };

  const createJobMutation = useMutation<JobSummary, Error, CreateJobPayload>({
    mutationFn: (payload) =>
      apiFetch<JobSummary>("/jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: TECHNICIANS_QUERY_KEY });
      if (job.vehicle_id) {
        queryClient.invalidateQueries({ queryKey: VEHICLES_QUERY_KEY });
      }
    toast({
        title: "Job created",
        description: `Job #${job.id} has been created successfully.`,
      });
      setCreateOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Unable to create job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateJob = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCustomer) {
      toast({
        title: "Customer required",
        description: "Please select a customer for this job.",
        variant: "destructive",
      });
      return;
    }

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      toast({
        title: "Description required",
        description: "Describe the work that needs to be carried out.",
        variant: "destructive",
      });
      return;
    }

    let parsedInitial: number | null | undefined = null;
    if (initialAmount.trim()) {
      const amount = Number(initialAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        toast({
          title: "Invalid amount",
          description: "Initial estimate must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      parsedInitial = amount;
    }

    let parsedAdvance: number | null | undefined = null;
    if (advanceAmount.trim()) {
      const amount = Number(advanceAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        toast({
          title: "Invalid advance payment",
          description: "Advance payment must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      parsedAdvance = amount;
    }

    let parsedMileage: number | null | undefined = null;
    if (mileage.trim()) {
      const mileageValue = Number(mileage);
      if (!Number.isFinite(mileageValue) || mileageValue < 0) {
        toast({
          title: "Invalid mileage",
          description: "Mileage must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      // Convert to kilometers (database stores in km)
      // If input is in miles, multiply by 1.60934; if in km, use as is
      parsedMileage = mileageUnit === "mi" ? mileageValue * 1.60934 : mileageValue;
      // Database stores in kilometers
      parsedMileage = mileageValue;
    }

    const payload: CreateJobPayload = {
      customer_id: selectedCustomer.id,
      description: trimmedDescription,
      notes: notes.trim() ? notes.trim() : null,
      job_status: jobStatus,
      technician_ids: assignedTechnicians,
      initial_amount: parsedInitial ?? null,
      advance_amount: parsedAdvance ?? null,
      mileage: parsedMileage ?? null,
    };

    const resolvedCategory = jobCategory.trim();
    payload.category = resolvedCategory ? resolvedCategory : null;

    if (selectedVehicle) {
      payload.vehicle_id = selectedVehicle.id;
    } else {
      const trimmedMake = vehicleMake.trim();
      const trimmedModel = vehicleModel.trim();

      if (!trimmedMake || !trimmedModel) {
    toast({
          title: "Vehicle details required",
          description: "Provide at least the vehicle make and model.",
          variant: "destructive",
        });
        return;
      }

      payload.vehicle = {
        make: trimmedMake,
        model: trimmedModel,
        year: vehicleYear.trim() || null,
        license_plate: vehicleLicensePlate.trim() || null,
      };
    }

    createJobMutation.mutate(payload);
  };

  const filteredJobs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== "all" && job.job_status !== statusFilter) return false;
      if (!query) return true;

      const vehicleLabel = formatVehicle(job).toLowerCase();
      const technicianNames = job.technicians.map((tech) => tech.name.toLowerCase()).join(" ");

      const haystack = [
        String(job.id),
        job.customer_name ?? "",
        job.category ?? "",
        job.description ?? "",
        job.notes ?? "",
        vehicleLabel,
        technicianNames,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [jobs, searchTerm, statusFilter]);

  const jobDetail = selectedJobDetail ?? (selectedJob as JobDetail | null);
  const jobHasInvoice = Boolean(jobDetail?.invoice_created || jobDetail?.invoice);

  const updateJobMutation = useMutation<
    JobSummary,
    Error,
    {
      id: number;
      payload: {
        job_status: JobStatus;
        notes: string | null;
        description: string;
        category: string | null;
        initial_amount: number | null;
        advance_amount: number | null;
        mileage?: number | null;
        technician_ids?: number[];
        create_invoice?: boolean;
      };
    }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<JobSummary>(`/jobs/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      toast({
        title: "Job updated",
        description: `Job #${job.id} updated successfully.`,
      });
      setSelectedJob(job);
      setSelectedJobDetail(job as JobDetail);
      setJobEditOpen(false);
      setJobDetailOpen(true);
    },
    onError: (error) => {
      toast({
        title: "Unable to update job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteJobMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/jobs/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      toast({
        title: "Job deleted",
        description: `Job #${id} has been removed.`,
      });
      setJobDeleteOpen(false);
      setJobDetailOpen(false);
      setJobEditOpen(false);
      setSelectedJob(null);
      setSelectedJobDetail(null);
    },
    onError: (error) => {
      toast({
        title: "Unable to delete job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createInvoiceMutation = useMutation<
    JobDetail & { invoice?: JobInvoiceSummary | null },
    Error,
    {
      id: number;
      payload: {
        job_status: JobStatus;
        notes: string | null;
        description: string;
        category: string | null;
        initial_amount: number | null;
        advance_amount: number | null;
        create_invoice: true;
      };
    }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<JobDetail & { invoice?: JobInvoiceSummary | null }>(`/jobs/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setSelectedJob(job);
      setSelectedJobDetail(job);
      setJobDetailOpen(false);
      toast({
        title: "Invoice created",
        description: `Invoice generated for job #${job.id}.`,
      });
      const invoiceId = job.invoice?.id;
      if (invoiceId) {
        navigate("/invoices", { state: { invoiceId } });
      } else {
        navigate("/invoices");
      }
    },
    onError: (error) => {
      toast({
        title: "Unable to create invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleJobRowClick = (job: JobSummary) => {
    setSelectedJob(job);
    setJobDetailOpen(true);
    setJobDetailLoading(true);
    setSelectedJobDetail(null);

    apiFetch<JobDetail>(`/jobs/${job.id}`)
      .then((detail) => {
        setSelectedJobDetail(detail);
      })
      .catch((error) => {
        toast({
          title: "Unable to load job",
          description: error.message,
          variant: "destructive",
        });
        setJobDetailOpen(false);
      })
      .finally(() => {
        setJobDetailLoading(false);
      });
  };

  const handleEditJobSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedJob) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const job_status = (formData.get("job_status") || selectedJob.job_status) as JobStatus;
    const categoryRaw = String(formData.get("category") ?? "").trim();
    const notesRaw = String(formData.get("notes") || "").trim();
    const descriptionRaw = String(formData.get("description") || "").trim();
    const initialRaw = String(formData.get("initial_amount") || "").trim();
    const advanceRaw = String(formData.get("advance_amount") || "").trim();
    const mileageRaw = String(formData.get("mileage") || "").trim();

    if (!descriptionRaw) {
      toast({
        title: "Description required",
        description: "Describe the work that needs to be carried out.",
        variant: "destructive",
      });
      return;
    }

    let initial_amount: number | null = null;
    if (initialRaw) {
      const parsed = Number(initialRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast({
          title: "Invalid estimate",
          description: "Estimated amount must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      initial_amount = parsed;
    }

    let advance_amount: number | null = null;
    if (advanceRaw) {
      const parsed = Number(advanceRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast({
          title: "Invalid advance",
          description: "Advance payment must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      advance_amount = parsed;
    }

    let mileage: number | null = null;
    if (mileageRaw) {
      const mileageValue = Number(mileageRaw);
      if (!Number.isFinite(mileageValue) || mileageValue < 0) {
        toast({
          title: "Invalid mileage",
          description: "Mileage must be a positive number.",
          variant: "destructive",
        });
        return;
      }
      // Database stores in kilometers
      mileage = mileageValue;
    }

    updateJobMutation.mutate({
      id: selectedJob.id,
      payload: {
        job_status,
        notes: notesRaw || null,
        description: descriptionRaw,
        category: categoryRaw ? categoryRaw : null,
        initial_amount,
        advance_amount,
        mileage,
        technician_ids: editTechnicians,
      },
    });
  };

  const handleDeleteJob = () => {
    if (!selectedJob) return;
    deleteJobMutation.mutate(selectedJob.id);
  };

  const handleCreateInvoiceFromJob = () => {
    const baseJob = selectedJobDetail ?? selectedJob;
    if (!baseJob) {
      toast({
        title: "No job selected",
        description: "Select a job to create an invoice.",
        variant: "destructive",
      });
      return;
    }

    if (baseJob.job_status !== "Completed") {
      toast({
        title: "Job not completed",
        description: "Complete the job before generating an invoice.",
        variant: "destructive",
      });
      return;
    }

    const descriptionValue = (baseJob.description ?? "").trim();
    if (!descriptionValue) {
      toast({
        title: "Description required",
        description: "Add a job description before generating an invoice.",
        variant: "destructive",
      });
      return;
    }

    createInvoiceMutation.mutate({
      id: baseJob.id,
      payload: {
        job_status: baseJob.job_status,
        notes: baseJob.notes ?? null,
        description: descriptionValue,
        category: (baseJob.category ?? "").trim() || null,
        initial_amount: baseJob.initial_amount ?? null,
        advance_amount: baseJob.advance_amount ?? null,
        create_invoice: true,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Manage Jobs</h1>
          <p className="text-muted-foreground">Create and track workshop jobs</p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) {
              resetForm();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" />
              Create Job
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Job</DialogTitle>
              <DialogDescription>Capture customer, vehicle, and assignment details.</DialogDescription>
            </DialogHeader>
            <form className="space-y-6" onSubmit={handleCreateJob}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Popover open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between"
                        disabled={customersLoading || customersError}
                      >
                        {selectedCustomer ? selectedCustomer.name : "Select customer"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search customers..." />
                        <CommandList>
                          <CommandEmpty>
                            {customersLoading
                              ? "Loading customers..."
                              : customersError
                              ? customersErrorObject?.message ?? "Unable to load customers."
                              : "No customer found."}
                          </CommandEmpty>
                          {!customersLoading && !customersError && (
                            <CommandGroup>
                              {customers.map((customer) => (
                                <CommandItem
                                  key={customer.id}
                                  value={`${customer.name} ${customer.email ?? ""} ${customer.phone ?? ""}`}
                                  onSelect={() => {
                                    setSelectedCustomer(customer);
                                    setCustomerPickerOpen(false);
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span>{customer.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {[customer.phone, customer.email].filter(Boolean).join(" • ") || "No contact info"}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobStatus">Job Status</Label>
                  <Select value={jobStatus} onValueChange={(value) => setJobStatus(value as JobStatus)}>
                    <SelectTrigger id="jobStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobCategory">Job Category</Label>
                  <Select value={jobCategory} onValueChange={setJobCategory}>
                    <SelectTrigger id="jobCategory">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_CATEGORY_OPTIONS.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initialAmount">Estimated Amount</Label>
                  <Input
                    id="initialAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={initialAmount}
                    onChange={(event) => setInitialAmount(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="advanceAmount">Advance Collected</Label>
                  <Input
                    id="advanceAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={advanceAmount}
                    onChange={(event) => setAdvanceAmount(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mileage">Mileage</Label>
                  <div className="flex gap-2">
                    <Input
                      id="mileage"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={mileageUnit === "km" ? "e.g. 50000" : "e.g. 31000"}
                      value={mileage}
                      onChange={(event) => setMileage(event.target.value)}
                      className="flex-1"
                    />
                    <Select value={mileageUnit} onValueChange={(value) => setMileageUnit(value as "km" | "mi")}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="km">Kilometers</SelectItem>
                        <SelectItem value="mi">Miles</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vehicleMake">Vehicle Make</Label>
                  <Input
                    id="vehicleMake"
                    placeholder="e.g. Honda"
                    value={vehicleMake}
                    onChange={(event) => setVehicleMake(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vehicleModel">Vehicle Model</Label>
                  <Input
                    id="vehicleModel"
                    placeholder="e.g. Civic"
                    value={vehicleModel}
                    onChange={(event) => setVehicleModel(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vehicleYear">Model Year</Label>
                  <Input
                    id="vehicleYear"
                    placeholder="e.g. 2020"
                    value={vehicleYear}
                    onChange={(event) => setVehicleYear(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vehiclePlate">Registration Number</Label>
                  <Input
                    id="vehiclePlate"
                    placeholder="e.g. ABC-1234"
                    value={vehicleLicensePlate}
                    onChange={(event) => setVehicleLicensePlate(event.target.value)}
                  />
                </div>
                </div>

              <div className="space-y-2">
                  <Label>Assign Technicians</Label>
                <div className="flex flex-col gap-2 rounded-md border p-4">
                  {techniciansLoading && <p className="text-sm text-muted-foreground">Loading technicians...</p>}
                  {techniciansError && (
                    <p className="text-sm text-destructive">
                      {techniciansErrorObject?.message ?? "Unable to load technicians."}
                    </p>
                  )}
                  {!techniciansLoading && !techniciansError && technicians.length === 0 && (
                    <p className="text-sm text-muted-foreground">No technicians available. Add technicians first.</p>
                  )}
                  {!techniciansLoading &&
                    !techniciansError &&
                    technicians.length > 0 &&
                    technicians.map((technician) => (
                      <label key={technician.id} className="flex items-center gap-3 text-sm">
                        <Checkbox 
                          id={`tech-${technician.id}`}
                          checked={assignedTechnicians.includes(technician.id)}
                          onCheckedChange={(checked) => toggleTechnician(technician.id, checked === true)}
                        />
                        <span className="flex-1">
                          {technician.name}
                          {technician.status !== "Active" && (
                            <span className="ml-2 text-xs text-muted-foreground">({technician.status})</span>
                          )}
                        </span>
                        </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                <Label htmlFor="jobDescription">Job Description</Label>
                <Textarea
                  id="jobDescription"
                  rows={3}
                  placeholder="Describe the job that needs to be performed."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobNotes">Notes (optional)</Label>
                <Textarea
                  id="jobNotes"
                  rows={2}
                  placeholder="Add any remarks or internal notes."
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreateOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary" disabled={createJobMutation.isPending}>
                  {createJobMutation.isPending ? "Creating..." : "Create Job"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search jobs by ID, customer, vehicle, technician, or description..."
                className="pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as JobStatus | "all")}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {JOB_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-3 font-medium">Job #</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Vehicle</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Category</th>
                  <th className="p-3 font-medium">Technicians</th>
                  <th className="p-3 font-medium">Estimate</th>
                  <th className="p-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {jobsLoading && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-muted-foreground">
                      Loading jobs...
                    </td>
                  </tr>
                )}
                {jobsError && !jobsLoading && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-destructive">
                      {jobsErrorObject?.message ?? "Unable to load jobs."}
                    </td>
                  </tr>
                )}
                {!jobsLoading && !jobsError && filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      No jobs found. Create a job to get started.
                    </td>
                  </tr>
                )}
                {!jobsLoading &&
                  !jobsError &&
                  filteredJobs.map((job) => (
                  <tr 
                    key={job.id} 
                      className="border-b last:border-b-0 cursor-pointer transition hover:bg-muted/50"
                      onClick={() => handleJobRowClick(job)}
                    >
                      <td className="p-3 font-semibold">#{job.id}</td>
                      <td className="p-3">{job.customer_name ?? `Customer #${job.customer_id}`}</td>
                      <td className="p-3 text-muted-foreground">{formatVehicle(job)}</td>
                    <td className="p-3">
                        <Badge className={STATUS_BADGE_STYLES[job.job_status]}>{job.job_status}</Badge>
                    </td>
                      <td className="p-3">{job.category ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">
                        {job.technicians.length > 0
                          ? job.technicians.map((tech) => tech.name).join(", ")
                          : "—"}
                      </td>
                      <td className="p-3 font-medium">{formatCurrency(job.initial_amount)}</td>
                      <td className="p-3 text-muted-foreground max-w-[220px] truncate" title={job.notes ?? "—"}>
                        {job.notes ?? "—"}
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={jobDetailOpen}
        onOpenChange={(open) => {
          setJobDetailOpen(open);
          if (!open && !jobEditOpen && !jobDeleteOpen) {
            setSelectedJob(null);
            setSelectedJobDetail(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Job details</DialogTitle>
            <DialogDescription>
              {selectedJob ? `Full information for job #${selectedJob.id}` : "Select a job to view details"}
            </DialogDescription>
          </DialogHeader>
          {jobDetailLoading && (
            <div className="rounded-md border border-dashed border-muted p-3 text-sm text-muted-foreground">
              Loading job details...
            </div>
          )}
          {jobDetail && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">Job #</Label>
                  <p className="font-semibold text-lg">#{jobDetail.id}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={STATUS_BADGE_STYLES[jobDetail.job_status]}>
                      {jobDetail.job_status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Category</Label>
                  <p className="font-semibold">
                    {jobDetail.category ?? "Not specified"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Customer</Label>
                  <p className="font-semibold">
                    {jobDetail.customer_name ?? `Customer #${jobDetail.customer_id}`}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created</Label>
                  <p className="font-semibold">{formatDateTime(jobDetail.created_at)}</p>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Vehicle</Label>
                  <p className="font-semibold">{formatVehicle(jobDetail)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Estimate</Label>
                  <p className="font-semibold">{formatCurrency(jobDetail.initial_amount)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Advance paid</Label>
                  <p className="font-semibold">{formatCurrency(jobDetail.advance_amount)}</p>
                </div>
                {jobDetail.mileage !== null && jobDetail.mileage !== undefined && (
                  <div>
                    <Label className="text-muted-foreground">Mileage</Label>
                    <p className="font-semibold">
                      {jobDetail.mileage.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: jobDetail.mileage % 1 === 0 ? 0 : 2,
                      })}{" "}
                      km
                    </p>
                  </div>
                )}
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Technicians</Label>
                  <p className="font-semibold">
                    {jobDetail.technicians.length
                      ? jobDetail.technicians.map((tech) => tech.name).join(", ")
                      : "No technicians assigned"}
                  </p>
              </div>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Description</Label>
                <p className="rounded-md border border-muted bg-muted/30 p-3 text-sm leading-relaxed">
                  {jobDetail.description ?? "No description provided."}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Notes</Label>
                <p className="rounded-md border border-muted bg-muted/30 p-3 text-sm leading-relaxed">
                  {jobDetail.notes ?? "No notes recorded."}
                </p>
              </div>
              {jobDetail.items && jobDetail.items.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Line items</Label>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="p-3 font-medium">Item</th>
                          <th className="p-3 font-medium">Qty</th>
                          <th className="p-3 font-medium">Unit price</th>
                          <th className="p-3 font-medium">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobDetail.items.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="p-3">
                              <span className="font-medium">{item.item_name}</span>
                              <span className="block text-xs text-muted-foreground capitalize">
                                {item.item_type}
                              </span>
                            </td>
                            <td className="p-3">{item.quantity}</td>
                            <td className="p-3">{formatCurrency(item.unit_price)}</td>
                            <td className="p-3 font-semibold">{formatCurrency(item.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {jobHasInvoice && jobDetail.invoice && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Invoice</Label>
                  <div className="rounded-md border border-muted bg-muted/30 p-3 text-sm">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <p className="font-semibold">
                        {jobDetail.invoice.invoice_no ?? `Invoice #${jobDetail.invoice.id}`}
                      </p>
                      <Badge variant="secondary" className="capitalize">
                        {jobDetail.invoice.payment_status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-base font-bold">
                      {formatCurrency(jobDetail.invoice.final_total)}
                    </p>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 border-t pt-4 md:flex-row">
                <Button 
                  variant="outline" 
                  className="md:flex-1"
                  onClick={() => {
                    setJobDetailOpen(false);
                    setJobEditOpen(true);
                  }}
                >
                  Edit
                </Button>
                {jobDetail.job_status === "Completed" && (
                  jobHasInvoice ? (
                    <Button
                      variant="secondary"
                      className="md:flex-1"
                      onClick={() =>
                        navigate("/invoices", {
                          state: jobDetail.invoice?.id
                            ? { invoiceId: jobDetail.invoice.id }
                            : undefined,
                        })
                      }
                    >
                      View Invoice
                    </Button>
                  ) : (
                    <Button
                      className="md:flex-1"
                      onClick={handleCreateInvoiceFromJob}
                      disabled={createInvoiceMutation.isPending}
                    >
                      {createInvoiceMutation.isPending ? "Creating Invoice..." : "Create Invoice"}
                    </Button>
                  )
                )}
                <Button 
                  variant="destructive" 
                  className="md:flex-1"
                  onClick={() => {
                    setJobDetailOpen(false);
                    setJobDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
          {!jobDetail && !jobDetailLoading && (
            <p className="text-sm text-muted-foreground">Select a job to view details.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={jobEditOpen}
        onOpenChange={(open) => {
          setJobEditOpen(open);
          if (open && selectedJob) {
            setEditTechnicians(selectedJob.technicians.map((t) => t.id));
          }
          if (!open && !jobDetailOpen && !jobDeleteOpen) {
            setSelectedJob(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit job</DialogTitle>
            <DialogDescription>
              {selectedJob ? `Update job #${selectedJob.id}` : "Select a job to begin editing"}
            </DialogDescription>
          </DialogHeader>
          {selectedJob && (
            <form onSubmit={handleEditJobSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="editJobStatus">Status</Label>
                  <select
                    id="editJobStatus"
                    name="job_status"
                    defaultValue={selectedJob.job_status}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {JOB_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editJobCategory">Category</Label>
                  <select
                    id="editJobCategory"
                    name="category"
                    defaultValue={selectedJob.category ?? ""}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Not specified</option>
                    {JOB_CATEGORY_OPTIONS.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editInitialAmount">Estimated amount</Label>
                  <Input
                    id="editInitialAmount"
                    name="initial_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={selectedJob.initial_amount ?? undefined}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editAdvanceAmount">Advance collected</Label>
                  <Input
                    id="editAdvanceAmount"
                    name="advance_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={selectedJob.advance_amount ?? undefined}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="editMileage">Mileage</Label>
                  <div className="flex gap-2">
                    <Input
                      id="editMileage"
                      name="mileage"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        selectedJob.mileage !== null && selectedJob.mileage !== undefined
                          ? selectedJob.mileage
                          : undefined
                      }
                      placeholder="e.g. 50000"
                      className="flex-1"
                    />
                    <Select
                      name="mileage_unit"
                      defaultValue="km"
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="km">Kilometers</SelectItem>
                        <SelectItem value="mi">Miles</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                </div>

              <div className="space-y-2">
                <Label>Assign Technicians</Label>
                <div className="flex flex-col gap-2 rounded-md border p-4">
                  {techniciansLoading && <p className="text-sm text-muted-foreground">Loading technicians...</p>}
                  {techniciansError && (
                    <p className="text-sm text-destructive">
                      {techniciansErrorObject?.message ?? "Unable to load technicians."}
                    </p>
                  )}
                  {!techniciansLoading && !techniciansError && technicians.length === 0 && (
                    <p className="text-sm text-muted-foreground">No technicians available. Add technicians first.</p>
                  )}
                  {!techniciansLoading &&
                    !techniciansError &&
                    technicians.length > 0 &&
                    technicians.map((technician) => (
                      <label key={technician.id} className="flex items-center gap-3 text-sm">
                        <Checkbox 
                          id={`edit-tech-${technician.id}`}
                          checked={editTechnicians.includes(technician.id)}
                          onCheckedChange={(checked) => toggleEditTechnician(technician.id, checked === true)}
                        />
                        <span className="flex-1">
                          {technician.name}
                          {technician.status !== "Active" && (
                            <span className="ml-2 text-xs text-muted-foreground">({technician.status})</span>
                          )}
                        </span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="editDescription">Job description</Label>
                <Textarea
                  id="editDescription"
                  name="description"
                  rows={3}
                  defaultValue={selectedJob.description ?? ""}
                  placeholder="Describe the work that needs to be performed."
                  required
                />
              </div>
                <div className="space-y-2">
                <Label htmlFor="editNotes">Notes</Label>
                <Textarea
                  id="editNotes"
                  name="notes"
                  rows={3}
                  defaultValue={selectedJob.notes ?? ""}
                  placeholder="Add internal notes about this job"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setJobEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateJobMutation.isPending}>
                  {updateJobMutation.isPending ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={jobDeleteOpen}
        onOpenChange={(open) => {
          setJobDeleteOpen(open);
          if (!open && !jobDetailOpen && !jobEditOpen) {
            setSelectedJob(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete job</DialogTitle>
            <DialogDescription>
              {selectedJob
                ? `Are you sure you want to delete job #${selectedJob.id}? This action cannot be undone.`
                : "Select a job to delete."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setJobDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteJob}
              disabled={deleteJobMutation.isPending || !selectedJob}
            >
              {deleteJobMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={vehicleSelectOpen}
        onOpenChange={(open) => {
          setVehicleSelectOpen(open);
          if (!open) {
            setVehiclePromptAcknowledged(true);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select a vehicle</DialogTitle>
            <DialogDescription>
              {vehiclesLoading
                ? "Fetching vehicles linked to this customer."
                : "Choose an existing vehicle or continue to add a new one."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {vehiclesError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {vehiclesErrorObject?.message ?? "Unable to load vehicles for this customer."}
              </p>
            )}
            {vehiclesLoading && (
              <p className="text-sm text-muted-foreground">Loading vehicles...</p>
            )}
            {!vehiclesLoading && !vehiclesError && vehiclesForCustomer.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No vehicles are linked to this customer yet. Continue to add a new vehicle.
              </p>
            )}
            {!vehiclesLoading &&
              !vehiclesError &&
              vehiclesForCustomer.map((vehicle) => (
                <Button
                  key={vehicle.id}
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => {
                    applyVehicleSelection(vehicle);
                    setVehiclePromptAcknowledged(true);
                    setVehicleSelectOpen(false);
                  }}
                >
                  <span>
                    {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unnamed vehicle"}
                    {vehicle.year ? ` ${vehicle.year}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {vehicle.license_plate || "No registration"}
                  </span>
                </Button>
              ))}
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                applyVehicleSelection(null);
                setVehiclePromptAcknowledged(true);
                setVehicleSelectOpen(false);
              }}
            >
              Add new vehicle
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Jobs;
