'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn, UserPlus, Package, ScanLine, BarChart2 } from 'lucide-react'; // Added ScanLine and BarChart2
import Link from 'next/link';
import { useTranslation } from '@/hooks/useTranslation';

const GuestHomePage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem)-8rem)] p-4 sm:p-6 md:p-8 home-background">
      <div className="w-full max-w-2xl text-center">
        <Package className="h-16 w-16 text-primary mx-auto mb-6 scale-fade-in" />
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-primary scale-fade-in delay-100">
          {t('welcome_message_app')}
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground mb-8 scale-fade-in delay-200">
          {t('guest_home_description')}
        </p>

        <Card className="bg-card/80 backdrop-blur-sm border-border/50 shadow-xl scale-fade-in delay-300">
          <CardHeader>
            <CardTitle className="text-xl sm:text-2xl">{t('guest_home_get_started_title')}</CardTitle>
            <CardDescription>{t('guest_home_get_started_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg" className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-shadow transform hover:scale-105">
              <Link href="/register">
                <UserPlus className="mr-2 h-5 w-5" /> {t('nav_register')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto border-primary text-primary hover:bg-primary/10 shadow-md hover:shadow-lg transition-shadow transform hover:scale-105">
              <Link href="/login">
                <LogIn className="mr-2 h-5 w-5" /> {t('nav_login')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div className="mt-12 space-y-6 scale-fade-in delay-400">
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground">{t('guest_home_features_title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <FeatureCard
              title={t('guest_home_feature_scan_title')}
              description={t('guest_home_feature_scan_desc')}
              icon={<ScanLine className="h-8 w-8 text-accent" />}
            />
            <FeatureCard
              title={t('guest_home_feature_inventory_title')}
              description={t('guest_home_feature_inventory_desc')}
              icon={<Package className="h-8 w-8 text-accent" />}
            />
            <FeatureCard
              title={t('guest_home_feature_insights_title')}
              description={t('guest_home_feature_insights_desc')}
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
