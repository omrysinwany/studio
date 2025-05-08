
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Briefcase, Menu, Palette, Sun, Moon, Settings as SettingsIcon, Home, ScanLine, Package, BarChart2, FileText, LogIn, UserPlus, LogOut, Plug, Languages } from 'lucide-react'; // Added Languages icon
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuPortal
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import React, { useState } from 'react';
import { useTheme } from 'next-themes';
import { useLanguage, Locale } from '@/context/LanguageContext'; // Import useLanguage
import { useTranslation } from '@/hooks/useTranslation'; // Import useTranslation

export default function Navigation() {
  const pathname = usePathname();
  const { user, logout, loading } = useAuth();
  const router = useRouter();
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLanguage(); // Get locale and setLocale
  const { t } = useTranslation(); // Get translation function

  const navItems = [
    { href: '/', labelKey: 'nav_home', icon: Home },
    { href: '/upload', labelKey: 'nav_upload', icon: ScanLine },
    { href: '/inventory', labelKey: 'nav_inventory', icon: Package },
    { href: '/invoices', labelKey: 'nav_invoices', icon: FileText },
    { href: '/suppliers', labelKey: 'nav_suppliers', icon: Briefcase },
    { href: '/reports', labelKey: 'nav_reports', icon: BarChart2 },
    { href: '/settings', labelKey: 'nav_settings', icon: SettingsIcon },
  ];

  const handleLogout = () => {
    logout();
    router.push('/login');
    setIsMobileSheetOpen(false);
  };

   const handleMobileNavClick = (href: string) => {
      router.push(href);
      setIsMobileSheetOpen(false);
   };

  const getInitials = (name: string | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const changeLanguage = (newLocale: Locale) => {
    setLocale(newLocale);
    if (isMobileSheetOpen) setIsMobileSheetOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm" style={{ '--header-height': '4rem' } as React.CSSProperties}>
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg hover:opacity-80 transition-opacity">
          <Package className="h-6 w-6 text-primary" />
          <span className="text-primary">{t('app_title')}</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-in-out",
                pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/')
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
               aria-current={pathname === item.href ? 'page' : undefined}
            >
              <item.icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <Button variant="ghost" size="icon" className='hidden md:inline-flex'>
                  <Palette className="h-[1.2rem] w-[1.2rem]" />
                  <span className="sr-only">{t('theme')}</span>
               </Button>
             </DropdownMenuTrigger>
             <DropdownMenuContent align="end">
               <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
               <DropdownMenuSeparator />
               <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                 <DropdownMenuRadioItem value="light">
                   <Sun className="mr-2 h-4 w-4" /> {t('light_theme')}
                 </DropdownMenuRadioItem>
                 <DropdownMenuRadioItem value="dark">
                   <Moon className="mr-2 h-4 w-4" /> {t('dark_theme')}
                 </DropdownMenuRadioItem>
                 <DropdownMenuRadioItem value="system">
                   <SettingsIcon className="mr-2 h-4 w-4" /> {t('system_theme')}
                 </DropdownMenuRadioItem>
               </DropdownMenuRadioGroup>
             </DropdownMenuContent>
           </DropdownMenu>

            {/* Language Switcher (Desktop) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="hidden md:inline-flex">
                  <Languages className="h-[1.2rem] w-[1.2rem]" />
                  <span className="sr-only">{t('language')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={locale} onValueChange={(value) => changeLanguage(value as Locale)}>
                  <DropdownMenuRadioItem value="en">{t('english')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="he">{t('hebrew')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

          <div className="hidden md:flex items-center gap-2">
              {loading ? (
                <div className="h-9 w-24 animate-pulse rounded-md bg-muted"></div>
              ) : user ? (
                 <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs">{getInitials(user.username)}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user.username}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                     <DropdownMenuItem onClick={() => router.push('/settings/pos-integration')}>
                       <Plug className="mr-2 h-4 w-4" />
                       <span>{t('pos_integration')}</span>
                     </DropdownMenuItem>
                     <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>{t('nav_logout')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Link href="/login" passHref legacyBehavior>
                    <Button variant="ghost" size="sm" as="a" className="flex items-center">
                        <LogIn className="mr-1 h-4 w-4" /> {t('nav_login')}
                    </Button>
                  </Link>
                  <Link href="/register" passHref legacyBehavior>
                    <Button size="sm" as="a" className="flex items-center">
                        <UserPlus className="mr-1 h-4 w-4" /> {t('nav_register')}
                    </Button>
                  </Link>
                </>
              )}
          </div>

            <div className="md:hidden">
              <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Menu className="h-6 w-6" />
                     <span className="sr-only">Toggle Navigation</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-full max-w-xs p-0 flex flex-col">
                    <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                   <div className="p-4 border-b">
                      <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg mb-4" onClick={() => setIsMobileSheetOpen(false)}>
                          <Package className="h-6 w-6 text-primary" />
                          <span className="text-primary">{t('app_title')}</span>
                      </Link>
                    </div>
                    <nav className="flex-grow overflow-y-auto p-4">
                        {navItems.map((item) => (
                          <Button
                             key={item.href}
                             variant={pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/') ? 'secondary' : 'ghost'}
                             className="w-full justify-start gap-2 text-base py-3 mb-1"
                             onClick={() => handleMobileNavClick(item.href)}
                          >
                             <item.icon className="h-5 w-5" />
                             {t(item.labelKey)}
                          </Button>
                        ))}
                      </nav>

                    <div className="mt-auto border-t p-4 space-y-4">
                         <div>
                           {loading ? (
                              <div className="h-10 w-full animate-pulse rounded-md bg-muted"></div>
                           ) : user ? (
                               <div className="flex flex-col gap-2">
                                   <div className="flex items-center gap-2 mb-2 border-b pb-2">
                                        <Avatar className="h-8 w-8">
                                            <AvatarFallback className="text-xs">{getInitials(user.username)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col">
                                            <p className="text-sm font-medium leading-none">{user.username}</p>
                                            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                    <Button variant="ghost" className="justify-start gap-2 text-base py-3" onClick={() => handleMobileNavClick('/settings/pos-integration')}>
                                       <Plug className="h-5 w-5" />
                                       {t('pos_integration')}
                                    </Button>
                                   <Button variant="ghost" className="justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-base py-3" onClick={handleLogout}>
                                      <LogOut className="h-5 w-5" />
                                      {t('nav_logout')}
                                   </Button>
                               </div>
                           ) : (
                               <div className="flex flex-col gap-2">
                                   <Button variant="outline" className="justify-center text-base py-3" onClick={() => handleMobileNavClick('/login')}>
                                      <LogIn className="mr-2 h-5 w-5" /> {t('nav_login')}
                                   </Button>
                                   <Button className="justify-center text-base py-3" onClick={() => handleMobileNavClick('/register')}>
                                      <UserPlus className="mr-2 h-5 w-5" /> {t('nav_register')}
                                   </Button>
                               </div>
                           )}
                         </div>

                         <div className="border-t pt-4">
                            <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" className="w-full justify-start gap-2 text-base py-3">
                                  <Palette className="h-5 w-5" /> {t('theme')}: <span className="ml-auto capitalize font-medium">{theme}</span>
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuPortal>
                                  <DropdownMenuContent align="start" side="top" className="w-[calc(100vw-2rem)] max-w-xs mb-2">
                                   <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
                                   <DropdownMenuSeparator />
                                   <DropdownMenuRadioGroup value={theme} onValueChange={(newTheme) => { setTheme(newTheme); }}>
                                     <DropdownMenuRadioItem value="light">
                                       <Sun className="mr-2 h-4 w-4" /> {t('light_theme')}
                                     </DropdownMenuRadioItem>
                                     <DropdownMenuRadioItem value="dark">
                                       <Moon className="mr-2 h-4 w-4" /> {t('dark_theme')}
                                     </DropdownMenuRadioItem>
                                     <DropdownMenuRadioItem value="system">
                                       <SettingsIcon className="mr-2 h-4 w-4" /> {t('system_theme')}
                                     </DropdownMenuRadioItem>
                                   </DropdownMenuRadioGroup>
                                 </DropdownMenuContent>
                              </DropdownMenuPortal>
                           </DropdownMenu>

                           {/* Language Switcher (Mobile) */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="w-full justify-start gap-2 text-base py-3">
                                  <Languages className="h-5 w-5" /> {t('language')}: <span className="ml-auto capitalize font-medium">{locale === 'he' ? t('hebrew') : t('english')}</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuContent align="start" side="top" className="w-[calc(100vw-2rem)] max-w-xs mb-2">
                                  <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuRadioGroup value={locale} onValueChange={(value) => changeLanguage(value as Locale)}>
                                    <DropdownMenuRadioItem value="en">{t('english')}</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="he">{t('hebrew')}</DropdownMenuRadioItem>
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                              </DropdownMenuPortal>
                            </DropdownMenu>
                         </div>
                    </div>
                </SheetContent>
              </Sheet>
            </div>
        </div>
      </div>
    </header>
  );
}
