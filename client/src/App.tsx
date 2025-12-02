import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "@/pages/Landing";
import Home from "@/pages/Home";
import Wetgeving from "@/pages/Wetgeving";
import LokaleRegelgeving from "@/pages/LokaleRegelgeving";
import Omgevingsplannen from "@/pages/Omgevingsplannen";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/rechtspraak" component={Home} />
      <Route path="/wetgeving" component={Wetgeving} />
      <Route path="/lokale-regelgeving" component={LokaleRegelgeving} />
      <Route path="/omgevingsplannen" component={Omgevingsplannen} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
