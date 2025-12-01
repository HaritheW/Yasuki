import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const mockJobs = [
  { id: "JOB001", customer: "John Smith", vehicle: "Honda Civic 2020", status: "Completed", technicians: ["Mike Johnson", "David Lee"], amount: "$250", remarks: "All parts replaced successfully" },
  { id: "JOB002", customer: "Sarah Williams", vehicle: "Toyota Camry 2019", status: "In Progress", technicians: ["David Lee"], amount: "$180", remarks: "Waiting for parts delivery" },
  { id: "JOB003", customer: "Robert Brown", vehicle: "Ford F-150 2021", status: "Pending", technicians: ["Mike Johnson"], amount: "$450", remarks: "Customer to confirm appointment" },
  { id: "JOB004", customer: "Emily Davis", vehicle: "BMW 3 Series 2022", status: "In Progress", technicians: ["Chris Martinez", "Mike Johnson"], amount: "$320", remarks: "Diagnostic in progress" },
];

const allTechnicians = ["Mike Johnson", "David Lee", "Chris Martinez"];

const Jobs = () => {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedJobDetail, setSelectedJobDetail] = useState<typeof mockJobs[0] | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTechnicians, setSelectedTechnicians] = useState<string[]>([]);
  const { toast } = useToast();

  const filteredJobs = statusFilter === "all" 
    ? mockJobs 
    : mockJobs.filter(job => job.status === statusFilter);

  const handleDelete = () => {
    toast({
      title: "Job Deleted",
      description: `Job ${selectedJobDetail?.id} has been deleted successfully.`,
    });
    setDeleteOpen(false);
    setDetailOpen(false);
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Job Updated",
      description: `Job ${selectedJobDetail?.id} has been updated successfully.`,
    });
    setEditOpen(false);
    setDetailOpen(false);
  };

  const handleTechnicianToggle = (techName: string) => {
    setSelectedTechnicians(prev => 
      prev.includes(techName) 
        ? prev.filter(t => t !== techName)
        : [...prev, techName]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-success text-success-foreground";
      case "In Progress":
        return "bg-warning text-warning-foreground";
      case "Pending":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Manage Jobs</h1>
          <p className="text-muted-foreground">Create and manage repair jobs</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" />
              Create Job
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Job</DialogTitle>
              <DialogDescription>Fill in the details to create a new repair job</DialogDescription>
            </DialogHeader>
            <form className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customer">Customer</Label>
                  <Select>
                    <SelectTrigger id="customer">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">+ Add New Customer</SelectItem>
                      <SelectItem value="john">John Smith</SelectItem>
                      <SelectItem value="sarah">Sarah Williams</SelectItem>
                      <SelectItem value="robert">Robert Brown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="make">Vehicle Make</Label>
                  <Input id="make" placeholder="e.g., Honda" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="model">Vehicle Model</Label>
                  <Input id="model" placeholder="e.g., Civic" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="year">Vehicle Year</Label>
                  <Input id="year" type="number" placeholder="e.g., 2020" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registration">Registration Number</Label>
                  <Input id="registration" placeholder="e.g., ABC-1234" />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label>Assign Technicians</Label>
                  <div className="border rounded-md p-4 space-y-3">
                    {allTechnicians.map((tech) => (
                      <div key={tech} className="flex items-center space-x-2">
                        <Checkbox 
                          id={tech}
                          checked={selectedTechnicians.includes(tech)}
                          onCheckedChange={() => handleTechnicianToggle(tech)}
                        />
                        <label htmlFor={tech} className="text-sm font-medium leading-none cursor-pointer">
                          {tech}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select defaultValue="pending">
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Job Description</Label>
                <Textarea id="description" placeholder="Describe the repair work needed..." rows={3} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="remarks">Remarks (Optional)</Label>
                <Textarea id="remarks" placeholder="Add any notes or remarks..." rows={2} />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary">
                  Create Job
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search jobs..." className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Job ID</th>
                  <th className="p-3 text-left text-sm font-medium">Customer</th>
                  <th className="p-3 text-left text-sm font-medium">Vehicle</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Technician</th>
                  <th className="p-3 text-left text-sm font-medium">Amount</th>
                  <th className="p-3 text-left text-sm font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => (
                  <tr 
                    key={job.id} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedJobDetail(job);
                      setDetailOpen(true);
                    }}
                  >
                    <td className="p-3 font-medium">{job.id}</td>
                    <td className="p-3">{job.customer}</td>
                    <td className="p-3 text-muted-foreground">{job.vehicle}</td>
                    <td className="p-3">
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                    </td>
                    <td className="p-3">{job.technicians.join(", ")}</td>
                    <td className="p-3 font-semibold">{job.amount}</td>
                    <td className="p-3 text-muted-foreground text-sm max-w-[200px] truncate">{job.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Job Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Job Details</DialogTitle>
            <DialogDescription>Complete information for {selectedJobDetail?.id}</DialogDescription>
          </DialogHeader>
          {selectedJobDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Job ID</Label>
                  <p className="font-semibold">{selectedJobDetail.id}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={getStatusColor(selectedJobDetail.status)}>{selectedJobDetail.status}</Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Customer</Label>
                  <p className="font-semibold">{selectedJobDetail.customer}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Technicians</Label>
                  <p className="font-semibold">{selectedJobDetail.technicians.join(", ")}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Vehicle</Label>
                  <p className="font-semibold">{selectedJobDetail.vehicle}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Amount</Label>
                  <p className="font-semibold text-lg">{selectedJobDetail.amount}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Remarks</Label>
                  <p className="font-semibold">{selectedJobDetail.remarks}</p>
                </div>
              </div>
              
              {selectedJobDetail.status === "Completed" && (
                <div className="pt-4 border-t">
                  <Button className="w-full bg-primary" onClick={() => window.location.href = '/invoices'}>
                    Generate Invoice
                  </Button>
                </div>
              )}

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
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Job Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
            <DialogDescription>Update job details for {selectedJobDetail?.id}</DialogDescription>
          </DialogHeader>
          {selectedJobDetail && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="editCustomer">Customer</Label>
                  <Input id="editCustomer" defaultValue={selectedJobDetail.customer} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editVehicle">Vehicle</Label>
                  <Input id="editVehicle" defaultValue={selectedJobDetail.vehicle} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editStatus">Status</Label>
                  <Select defaultValue={selectedJobDetail.status}>
                    <SelectTrigger id="editStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editAmount">Amount</Label>
                  <Input id="editAmount" defaultValue={selectedJobDetail.amount} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="editRemarks">Remarks</Label>
                  <Textarea id="editRemarks" defaultValue={selectedJobDetail.remarks} rows={3} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary">
                  Save Changes
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete job {selectedJobDetail?.id}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Jobs;
