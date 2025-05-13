// src/components/GuestHomePage.tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn, UserPlus, Package, ScanLine, BarChart2 } from 'lucide-react';
import Link from 'next/link';
// import { useTranslation } from '@/hooks/useTranslation'; // t will return keys

const GuestHomePage: React.FC = () => {
  // const { t } = useTranslation(); // t will return keys

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem)-8rem)] p-4 sm:p-6 md:p-8 home-background">
      <div className="w-full max-w-2xl text-center">
        <Package className="h-16 w-16 text-primary mx-auto mb-6 scale-fade-in" />
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-primary scale-fade-in delay-100">
          Welcome to InvoTrack
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground mb-8 scale-fade-in delay-200">
          Efficiently manage your inventory, scan invoices, and gain valuable insights into your business operations. Sign up or log in to get started.
        </p>

        <Card className="bg-card/80 backdrop-blur-sm border-border/50 shadow-xl scale-fade-in delay-300">
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl">Get Started with InvoTrack</CardTitle>
            <CardDescription>Create an account or log in to access all features.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg" className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-shadow transform hover:scale-105">
              <Link href="/register">
                <UserPlus className="mr-2 h-5 w-5" /> Register
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto border-primary text-primary hover:bg-primary/10 shadow-md hover:shadow-lg transition-shadow transform hover:scale-105">
              <Link href="/login">
                <LogIn className="mr-2 h-5 w-5" /> Login
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div className="mt-12 space-y-6 scale-fade-in delay-400">
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground">Key Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <FeatureCard
              title="Effortless Scanning"
              description="Quickly digitize invoices and delivery notes using your device's camera."
              icon={<ScanLine className="h-8 w-8 text-accent" />}
            />
            <FeatureCard
              title="Smart Inventory"
              description="Keep track of your stock levels, costs, and sale prices with ease."
              icon={<Package className="h-8 w-8 text-accent" />}
            />
            <FeatureCard
              title="Actionable Insights"
              description="Generate reports and understand your business performance better."
              icon={<BarChart2 className="h-8 w-8 text-accent" />}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description }) => {
  return (
    <Card className="bg-card/70 backdrop-blur-sm border-border/40 hover:shadow-lg transition-shadow">
      <CardHeader className="flex flex-row items-center gap-4 pb-2">
        {icon}
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
};

export default GuestHomePage;
